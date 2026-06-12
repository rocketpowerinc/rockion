import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Wails serves the built assets from dist/. The dev server port is auto-detected.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("prosemirror") ||
            id.includes("@tiptap/pm")
          ) {
            return "prosemirror";
          }
          if (
            id.includes("@tiptap") ||
            id.includes("tiptap-markdown") ||
            id.includes("global-drag-handle")
          ) {
            return "editor";
          }
          if (id.includes("highlight.js") || id.includes("lowlight")) {
            return "syntax";
          }
          if (id.includes("react")) return "react";
        },
      },
    },
  },
});
