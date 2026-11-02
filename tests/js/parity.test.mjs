// Checks the browser NLU against the Python reference (tests/fixtures/parity.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { words } from "../../src/nlu/tokenizer.js";
import { intentFeatures, slotFeatures } from "../../src/nlu/features.js";
import { classifyIntent, decodeSlots } from "../../src/nlu/models.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (p) => JSON.parse(readFileSync(join(root, ...p), "utf8"));
const parity = load(["tests", "fixtures", "parity.json"]);
const flags = load(["src", "nlu", "model", "flags.json"]);
const intentModel = load(["src", "nlu", "model", "intent.json"]);
const crf = load(["src", "nlu", "model", "slots.json"]);

test("tokenizer and intent features match Python exactly", () => {
  for (const c of parity) {
    const toks = words(c.text);
    assert.deepEqual(toks, c.tokens, `tokens differ for: ${c.text}`);
    assert.deepEqual(intentFeatures(toks, flags), c.intent_features, `intent features differ: ${c.text}`);
  }
});

test("slot features match Python exactly", () => {
  for (const c of parity) {
    const toks = words(c.text);
    toks.forEach((_, i) => {
      assert.deepEqual(slotFeatures(toks, i, c.intent_pred, flags), c.slot_features[i],
        `slot feature mismatch at ${i} for: ${c.text}`);
    });
  }
});

test("intent predictions agree with the Python reference on >= 95% of cases", () => {
  let agree = 0;
  const misses = [];
  for (const c of parity) {
    const got = classifyIntent(intentModel, words(c.text), flags);
    if (got.rawIntent === c.intent_pred) agree++;
    else misses.push(`${c.text} -> js:${got.rawIntent} py:${c.intent_pred}`);
  }
  const rate = agree / parity.length;
  assert.ok(rate >= 0.95, `agreement ${rate.toFixed(3)}; misses: ${misses.join(" | ")}`);
});

test("CRF decoding agrees with Python Viterbi on >= 95% of tokens", () => {
  let same = 0, total = 0;
  for (const c of parity) {
    const toks = words(c.text);
    if (!toks.length) continue;
    decodeSlots(crf, toks, c.intent_pred, flags).forEach((lab, i) => {
      total++;
      if (lab === c.slot_pred[i]) same++;
    });
  }
  assert.ok(same / total >= 0.95, `token agreement ${(same / total).toFixed(3)}`);
});
