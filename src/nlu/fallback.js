// Optional backup intent parser (Gemini, via the local server). Never called unless the local
// model is unsure, and never trusted blindly: the answer must be a known intent name.
export const KNOWN_INTENTS = new Set([
  "create_object", "resize_object", "scale_object", "move_object", "rotate_object", "set_color",
  "set_material", "set_value", "set_property", "delete_object", "clear_scene", "duplicate_object",
  "select_object", "rename_object", "undo", "redo", "set_view", "set_mode", "connect_parts",
  "export_file", "save_project", "query_scene", "help",
]);

export async function fallbackEnabled() {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (!r.ok) return false;
    return (await r.json()).fallback === "gemini";
  } catch {
    return false;
  }
}

// Returns a known intent name, or null if unavailable / unsure / invalid.
export async function askFallback(text, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const { intent } = await r.json();
    return KNOWN_INTENTS.has(intent) ? intent : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
