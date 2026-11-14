import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Deliberately no `resolve.alias` for @av-pi-studio/ui-library: the gallery resolves the library
// through its package `exports` (the built `dist`), exactly like an external consumer would.
export default defineConfig({
  plugins: [react()],
  build: { target: "es2022" },
});
