import { PACKAGE_VERSION } from "./version.generated.js";

// Aligned workspace version, generated from packages/server/package.json by
// `scripts/gen-version.mjs` (never the root one — the root package.json deliberately carries no
// "version" field). Generated at build/typecheck/test time, so it always equals the package version
// the release bump wrote; a static import, so Bun's bundler follows it.
export const SERVER_VERSION: string = PACKAGE_VERSION;

/** The package `npm install -g` installs and updates: the CLI, which depends on this server. */
export const PACKAGE_NAME = "@av-pi-studio/cli";
