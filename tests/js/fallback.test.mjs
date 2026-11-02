// Gemini backup parser: no network, fake fetch only. The key must never leak into responses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, validateIntent, parseModelReply, keyStatus, INTENTS } from "../../server/gemini.mjs";

const reply = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

test("accepts only known intent names", () => {
  assert.equal(validateIntent("Scale_Object"), "scale_object");
  assert.equal(validateIntent("launch_missiles"), null);
  assert.equal(validateIntent(undefined), null);
  assert.ok(INTENTS.includes("clear_scene"));
});

test("parses a valid model reply and rejects chatter", () => {
  assert.equal(parseModelReply({ candidates: [{ content: { parts: [{ text: '{"intent":"undo"}' }] } }] }), "undo");
  assert.equal(parseModelReply({ candidates: [{ content: { parts: [{ text: "sure, here you go" }] } }] }), null);
  assert.equal(parseModelReply({}), null);
});

test("classify returns the intent and sends the key only in a header", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return reply('{"intent":"clear_scene"}'); };
  const r = await classify("wipe everything", { apiKey: "SECRET-KEY-123", fetchImpl });
  assert.deepEqual(r, { intent: "clear_scene", source: "gemini" });
  assert.equal(seen.init.headers["x-goog-api-key"], "SECRET-KEY-123");
  assert.ok(!seen.url.includes("SECRET-KEY-123"));
  assert.ok(!JSON.stringify(r).includes("SECRET-KEY-123"));
});

test("unavailable without a key, no network call", async () => {
  let called = false;
  const r = await classify("undo", { apiKey: "", fetchImpl: async () => { called = true; } });
  assert.equal(r.source, "unavailable");
  assert.equal(called, false);
  assert.equal(keyStatus(""), "disabled");
  assert.equal(keyStatus("x"), "gemini");
});

test("HTTP errors and network failures are reported, not thrown", async () => {
  const bad = await classify("undo", { apiKey: "k", fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(bad.source, "error");
  assert.match(bad.error, /429/);
  const down = await classify("undo", { apiKey: "k", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(down.source, "error");
  assert.equal(down.intent, null);
});
