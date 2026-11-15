import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// By relative source path: Node loads this file, and the aliases below do not apply to it.
import { pdfjsAssetsPlugin } from "../../../packages/workbench/vite/index.js";

const packages = resolve(import.meta.dirname, "../../../packages");

// The desktop client has one version, the Cargo workspace's.
const cargoManifest = readFileSync(resolve(import.meta.dirname, "../../Cargo.toml"), "utf8");
const version = /^\[workspace\.package\]$[^[]*?^version = "([^"]+)"$/m.exec(cargoManifest)?.[1];
if (!version) throw new Error("desktop/Cargo.toml has no [workspace.package] version");

export default defineConfig({
  plugins: [react(), pdfjsAssetsPlugin()],
  clearScreen: false,
  // The pdf.js worker is an ES module upstream; emit it as a module worker.
  worker: { format: "es" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    // The monorepo's packages from source, as `packages/web-client` does: a change to the
    // workbench shows up here without building it, and `vite build` needs no package's `dist`.
    alias: {
      "@av-pi-studio/protocol": resolve(packages, "protocol/src/index.ts"),
      "@av-pi-studio/relay": resolve(packages, "relay/src/index.ts"),
      "@av-pi-studio/client": resolve(packages, "client/src/index.ts"),
      // The more specific keys first: an alias is a prefix match.
      "@av-pi-studio/ui-library/reset.css": resolve(packages, "ui-library/src/reset.css"),
      "@av-pi-studio/ui-library": resolve(packages, "ui-library/src/index.ts"),
      "@av-pi-studio/workbench/fonts.css": resolve(packages, "workbench/src/fonts.css"),
      "@av-pi-studio/workbench": resolve(packages, "workbench/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    // `src-tauri/tauri.dev.conf.json` points the app at this port.
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    // The files are embedded in the binary and read from memory: a large chunk costs no download.
    chunkSizeWarningLimit: 8000,
  },
  test: { include: ["src/**/*.test.ts"] },
});
