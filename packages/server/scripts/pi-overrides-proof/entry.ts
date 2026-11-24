/**
 * Scratch entry of the sprint-139/task-001 gate: the smallest compiled program that applies
 * `applyPiOverrides` and then runs Pi's own Bun entry, like the binary's `__pi` sub-command will.
 * Built and run by `run.sh`; never part of the product build.
 *
 *   pi-proof __pi <pi args…>
 *
 * `PI_PROOF_NO_EXCLUDE=1` keeps the `bun` package manager but excludes nothing: the control that
 * shows the known failure (pi-background-tasks stops Pi under Bun).
 */
import { dirname, join } from "node:path";

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { BINARY_EXCLUDED_PACKAGES } from "../../src/runtime/excluded-packages.ts";
import { applyPiOverrides } from "../../src/runtime/pi-overrides.ts";

if (process.argv[2] !== "__pi") {
  console.error("usage: pi-proof __pi <pi args…>");
  process.exit(2);
}
process.argv.splice(2, 1);

applyPiOverrides(
  { SettingsManager, DefaultPackageManager },
  {
    bunScript: join(dirname(process.execPath), "bun"),
    excluded: process.env.PI_PROOF_NO_EXCLUDE ? [] : BINARY_EXCLUDED_PACKAGES,
  },
);

// Dynamic on purpose: Pi's entry runs its CLI on import, so the overrides above must be applied first
// (a static import is evaluated before this module's body).
await import("../../../../node_modules/@earendil-works/pi-coding-agent/dist/bun/cli.js");
