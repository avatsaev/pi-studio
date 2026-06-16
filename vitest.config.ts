import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Per-file run style: `npx vitest run <file>`. Discover tests across all packages.
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
