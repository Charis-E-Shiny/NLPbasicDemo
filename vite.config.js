import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/")) {
            return "vendor-react";
          }
          if (id.includes("/node_modules/three/examples/jsm/exporters/")) return "vendor-three-exporters";
          if (id.includes("/node_modules/three/examples/jsm/controls/")) return "vendor-three-controls";
          if (id.includes("/node_modules/three/")) return "vendor-three";
          if (id.includes("/node_modules/html2canvas/")) return "vendor-html2canvas";
          if (id.includes("/node_modules/canvg/")) return "vendor-canvg";
          if (id.includes("/node_modules/jspdf/")) return "vendor-pdf";
        }
      }
    }
  }
});
