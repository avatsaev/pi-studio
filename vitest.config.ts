import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@av-pi-studio/ui-library": resolve(__dirname, "packages/ui-library/src/index.ts"),
      "@av-pi-studio/workbench": resolve(__dirname, "packages/workbench/src/index.ts"),
      "@web-client": resolve(__dirname, "packages/web-client/src"),
    },
  },
  test: {
    // Per-file run style: `npx vitest run <file>`. Discover tests across all packages.
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
