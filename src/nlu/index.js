// Public NLU entry point. Models are bundled at build time, so parsing is synchronous and offline.
import intentModel from "./model/intent.json" with { type: "json" };
import slotModel from "./model/slots.json" with { type: "json" };
import flagModel from "./model/flags.json" with { type: "json" };
import { tokenize } from "./tokenizer.js";
import { classifyIntent, decodeSlots, bioToEntities } from "./models.js";

const model = { intent: intentModel, slots: slotModel, flags: flagModel };

// text -> { intent, confidence, rawIntent, entities: [{type, text}], tokens }
// intent is "unknown" when the local model is below its confidence threshold.
export function parse(text) {
  const { text: norm, tokens } = tokenize(text);
  const toks = tokens.map((t) => t.token);
  if (toks.length === 0) return { intent: "unknown", confidence: 0, rawIntent: null, entities: [], tokens: [] };
  const cls = classifyIntent(model.intent, toks, model.flags);
  if (cls.rawIntent === "oos") cls.intent = "unknown"; // "oos" = not a design command
  const labels = decodeSlots(model.slots, toks, cls.rawIntent, model.flags);
  const entities = bioToEntities(norm, tokens, labels).map((e) => ({ type: e.type, text: e.text }));
  return { ...cls, entities, tokens: toks };
}

// Re-tag the same utterance under a chosen intent (used when the backup parser decides).
export function parseWithIntent(text, intent) {
  const { text: norm, tokens } = tokenize(text);
  const toks = tokens.map((t) => t.token);
  const labels = decodeSlots(model.slots, toks, intent, model.flags);
  const entities = bioToEntities(norm, tokens, labels).map((e) => ({ type: e.type, text: e.text }));
  return { intent, rawIntent: intent, confidence: 1, source: "fallback", entities, tokens: toks };
}
