import { join } from "node:path";

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { BINARY_EXCLUDED_PACKAGES } from "../runtime/excluded-packages.js";
import { applyPiOverrides } from "../runtime/pi-overrides.js";
import { assetsDir, isBinary } from "../runtime/self.js";

/**
 * What the compiled single binary does before it runs Pi or the daemon (`swe/architecture/
 * single-binary-daemon.md` § The runtime seam, § Pi's settings; A6, A7). Nothing here runs on Node:
 * the daemon and the CLI call it behind `isBinary`.
 *
 * Pi's own files (`dist/bun/*.js`, the `skills` CLI) are reached by a path inside `node_modules`,
 * not by package name: Pi's `exports` map does not publish `dist/bun/`, and Bun's bundler follows a
 * literal specifier either way. The paths are relative to this module, which sits at the same depth
 * in `src/` and in `dist/`, so the compiled and the type-checked copies agree.
 */

/** Pi's package manager is the `bun` script beside the binary, and excluded packages are not loaded. */
function applyBinaryPiOverrides(): void {
  applyPiOverrides(
    { SettingsManager, DefaultPackageManager },
    { bunScript: join(assetsDir(), "bun"), excluded: BINARY_EXCLUDED_PACKAGES },
  );
}

/**
 * Prepares the daemon process for the Pi SDK it uses in-process: Pi's Bun runtime setup (without it
 * an OAuth login fails with `Cannot find module './anthropic.js'`) and the settings overrides, so
 * `pi install` and the resource service use the `bun` script and leave out the excluded packages.
 * A no-op on Node. Call before `runDaemon`.
 */
export async function prepareBinaryDaemon(): Promise<void> {
  if (!isBinary) return;
  // Dynamic on purpose: the module has process-wide side effects (process title, warnings, OAuth
  // flows) that Node must never get, so it is imported only in the binary.
  await import("../../../../node_modules/@earendil-works/pi-coding-agent/dist/bun/runtime-setup.js");
  applyBinaryPiOverrides();
}

/**
 * Runs Pi's own Bun entry as this process, with `process.argv` already stripped of the `__pi`
 * sub-command. Pi's entry runs its CLI on import, so the overrides are applied first.
 */
export async function runBundledPiCli(): Promise<void> {
  applyBinaryPiOverrides();
  // Dynamic on purpose: Pi's entry runs on import, and a static import is evaluated before this
  // module's body, i.e. before the overrides above.
  await import("../../../../node_modules/@earendil-works/pi-coding-agent/dist/bun/cli.js");
}

/**
 * Runs the pinned `skills` CLI as this process (`process.argv` already stripped of `__skills`).
 * `dist/cli.mjs` rather than `bin/cli.mjs`: the bin file only enables Node's compile cache.
 */
export async function runBundledSkillsCli(): Promise<void> {
  // Dynamic on purpose: the CLI runs on import and reads `process.argv`.
  await import("skills/dist/cli.mjs");
}
