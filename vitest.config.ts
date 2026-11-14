import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@av-pi-studio/ui-library": resolve(__dirname, "packages/ui-library/src/index.ts"),
      // More specific key first: aliases are prefix matches.
      "@av-pi-studio/workbench/fonts.css": resolve(__dirname, "packages/workbench/src/fonts.css"),
      "@av-pi-studio/workbench": resolve(__dirname, "packages/workbench/src/index.ts"),
    },
  },
  test: {
    // Per-file run style: `npx vitest run <file>`. Discover tests across all packages.
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
