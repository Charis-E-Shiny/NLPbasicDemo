import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { classify, keyStatus, DEFAULT_MODEL } from "./server/gemini.mjs";

// Serves /api/status and /api/parse in both `vite` (dev) and `vite preview`.
// The Gemini key stays on the server; the browser only learns whether a backup is configured.
function aiBackupPlugin(env) {
  const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
  const model = env.GEMINI_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const send = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  const middleware = async (req, res, next) => {
    if (req.url === "/api/status" && req.method === "GET") {
      return send(res, 200, { fallback: keyStatus(apiKey) });
    }
    if (req.url === "/api/parse" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return send(res, 413, { error: "payload too large" });
      }
      let data;
      try { data = JSON.parse(raw || "{}"); } catch { return send(res, 400, { error: "bad json" }); }
      return send(res, 200, await classify(String(data.text ?? ""), { apiKey, model }));
    }
    next();
  };
  return {
    name: "cadvoice-ai-backup",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), aiBackupPlugin(env)],
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/")) return "vendor-react";
            if (id.includes("/node_modules/three/examples/jsm/exporters/")) return "vendor-three-exporters";
            if (id.includes("/node_modules/three/examples/jsm/controls/")) return "vendor-three-controls";
            if (id.includes("/node_modules/three/examples/jsm/loaders/")) return "vendor-three-loaders";
            if (id.includes("/node_modules/three/")) return "vendor-three";
            if (id.includes("/node_modules/html2canvas/")) return "vendor-html2canvas";
            if (id.includes("/node_modules/canvg/")) return "vendor-canvg";
            if (id.includes("/node_modules/jspdf/")) return "vendor-pdf";
          },
        },
      },
    },
  };
});
