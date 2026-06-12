import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Wails serves the built assets from dist/. The dev server port is auto-detected.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "prosemirror",
              test: /node_modules[\\/](?:prosemirror-|@tiptap[\\/]pm)/,
              priority: 40,
            },
            {
              name: "editor",
              test: /node_modules[\\/](?:@tiptap|tiptap-markdown|tiptap-extension-global-drag-handle)/,
              priority: 30,
            },
            {
              name: "syntax",
              test: /node_modules[\\/](?:highlight\.js|lowlight)/,
              priority: 20,
            },
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
