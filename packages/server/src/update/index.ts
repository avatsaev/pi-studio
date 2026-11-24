// Update engine: the pure and process-control surface the CLI's `update` command consumes
// (npm lookups/installs, version comparison, install kind). No daemon lifecycle code.
export { PACKAGE_NAME } from "../version.js";
export * from "./install-kind.js";
export * from "./npm.js";
export * from "./process-wait.js";
