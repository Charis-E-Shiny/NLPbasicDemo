// Gemini backup intent parser. Runs only on the Node side (Vite dev/preview server).
// The API key is read from GEMINI_API_KEY (environment or .env) and is sent only in a request
// header to Google. It is never returned to the browser and never written into the build.
export const INTENTS = [
  "create_object", "resize_object", "scale_object", "move_object", "rotate_object", "set_color",
  "set_material", "set_value", "set_property", "delete_object", "clear_scene", "duplicate_object",
  "select_object", "rename_object", "undo", "redo", "set_view", "set_mode", "connect_parts",
  "export_file", "save_project", "query_scene", "help",
];
export const DEFAULT_MODEL = "gemini-2.0-flash";
const API_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const PROMPT =
  "You classify short voice commands for a CAD/ECAD design app.\n" +
  'Reply with JSON only: {"intent": "<one of the list>"}.\n' +
  'Use "unknown" if the sentence is not a design command.\n' +
  `Allowed intents: ${[...INTENTS, "unknown"].join(", ")}.\nCommand: `;

// Only known intent names pass. Anything else (invented names, chatter) is rejected.
export function validateIntent(raw) {
  const candidate = String(raw ?? "").trim().toLowerCase();
  return INTENTS.includes(candidate) ? candidate : null;
}

export function parseModelReply(body) {
  try {
    const text = body.candidates[0].content.parts[0].text;
    return validateIntent(JSON.parse(text).intent);
  } catch {
    return null;
  }
}

export function keyStatus(apiKey) {
  return apiKey && apiKey.trim() ? "gemini" : "disabled";
}

export async function classify(text, { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!apiKey || !apiKey.trim()) return { intent: null, source: "unavailable", error: "GEMINI_API_KEY is not set" };
  const clean = String(text ?? "").trim().slice(0, 300);
  if (!clean) return { intent: null, source: "gemini" };
  const payload = {
    contents: [{ parts: [{ text: PROMPT + clean }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 40 },
  };
  try {
    const res = await fetchImpl(API_URL(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { intent: null, source: "error", error: `Gemini HTTP ${res.status}` };
    return { intent: parseModelReply(await res.json()), source: "gemini" };
  } catch (error) {
    return { intent: null, source: "error", error: `Gemini unreachable: ${error.name === "TimeoutError" ? "timed out" : error.message}` };
  }
}
