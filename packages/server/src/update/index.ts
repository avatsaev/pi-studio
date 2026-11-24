// Update engine: the pure and process-control surface the CLI's `update` command consumes
// (npm lookups/installs, version comparison, install kind; the binary's manifest, install, link
// switch and helper). No daemon lifecycle code.
export { PACKAGE_NAME } from "../version.js";
export * from "./binary-helper.js";
export * from "./binary-install.js";
export * from "./binary-layout.js";
export * from "./binary-manifest.js";
export * from "./binary-update.js";
export * from "./install-kind.js";
export * from "./npm.js";
export * from "./process-wait.js";
export * from "./tar-extract.js";
