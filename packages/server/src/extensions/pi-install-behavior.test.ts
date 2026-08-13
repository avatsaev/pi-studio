import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveBundledPiCli } from "../agent/providers/pi/rpc-transport.js";

/**
 * Offline half of task-001's live-`pi` verification (swe/features/preinstalled-extensions.md
 * § TODO(verify)). The network-dependent probes (write-path honouring, reinstall idempotency,
 * non-interactive completion, 404 stderr fidelity, no-partial-write-on-failure) were run manually
 * against the bundled pi 0.84.1 and are recorded in the spec + this task's summary — they are not
 * committed as automated tests because the root suite must stay offline and network-free.
 *
 * This test locks in the **read-side** half of path parity with no network and no registry: the
 * bundled `pi` reads its `packages` list from a `settings.json` seeded directly under
 * `PI_CODING_AGENT_DIR`, exactly the shape a successful `pi install` would have written.
 */
describe("bundled pi reads packages from a seeded PI_CODING_AGENT_DIR (offline)", () => {
  it("`pi list` reports a package listed in a hand-seeded settings.json, no install/network needed", () => {
    const cli = resolveBundledPiCli();
    expect(cli).toBeTruthy();

    const agentDir = mkdtempSync(join(tmpdir(), "pi-install-behavior-"));
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["npm:pi-web-access"] }, null, 2),
    );

    const output = execFileSync(process.execPath, [cli as string, "list"], {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(output).toContain("npm:pi-web-access");

    // The read is genuinely read-only: seeding, then listing, never mutates the file we wrote.
    const settingsAfter = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    expect(settingsAfter).toEqual({ packages: ["npm:pi-web-access"] });
  });
});
