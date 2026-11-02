// Data-integrity checks for the bundled models and the object-to-model mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokenize } from "../../src/nlu/tokenizer.js";
import { REAL_MODEL_FOR_TYPE } from "../../src/realModelMap.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalog = JSON.parse(readFileSync(join(root, "public", "models3d", "catalog.json"), "utf8")).models;

test("tokenizer normalises case and keeps hex colours and decimals", () => {
  const { tokens } = tokenize("Make it #FF8800 and 1.5 times");
  assert.deepEqual(tokens.map((t) => t.token), ["make", "it", "#ff8800", "and", "1.5", "times"]);
});

test("every catalog model has a non-empty file and licence metadata", () => {
  assert.ok(catalog.length >= 14);
  for (const m of catalog) {
    assert.ok(readFileSync(join(root, "public", "models3d", m.file)).length > 1000, `${m.file} is empty`);
    assert.ok(m.license && m.author && m.source, `${m.id} is missing licence metadata`);
  }
});

test("every mapped object type points at a catalog model", () => {
  const ids = new Set(catalog.map((m) => m.id));
  for (const [type, id] of Object.entries(REAL_MODEL_FOR_TYPE)) {
    assert.ok(ids.has(id), `${type} -> ${id} is not in the catalog`);
  }
});
