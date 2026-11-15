import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Relative URLs: the same build is embedded by Tauri and loaded from disk by `npm run snapshot`.
  base: "./",
  clearScreen: false,
  server: {
    // `src-tauri/tauri.dev.conf.json` points the app at this port.
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"] },
});
