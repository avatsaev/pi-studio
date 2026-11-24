import { createRequire } from "node:module";

// Aligned workspace version, read from packages/server/package.json (never the root one — the
// root package.json deliberately carries no "version" field). This module sits one level below
// the package root in both `src/` and compiled `dist/`, so the specifier is "../package.json".
export const SERVER_VERSION: string = createRequire(import.meta.url)("../package.json")
  .version as string;

/** The package `npm install -g` installs and updates: the CLI, which depends on this server. */
export const PACKAGE_NAME = "@av-pi-studio/cli";
