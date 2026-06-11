import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Wails serves the built assets from dist/. The dev server port is auto-detected.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
