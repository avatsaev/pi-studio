import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@pi-studio-ui": resolve(__dirname, "packages/web-client/src"),
    },
  },
  test: {
    // Per-file run style: `npx vitest run <file>`. Discover tests across all packages.
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
