import type { DaemonOptions } from "../daemon/bootstrap.js";

/**
 * Update-service seams for the daemon tests of the check on connect: a clock and a release channel
 * the test moves, every other probe answered as an updatable npm install, and a count of the asks
 * the channel got. The daemon's own check at start-up uses them too: the clock reads 1 000 ms then.
 */
export interface UpdateCheckRig {
  seams: NonNullable<DaemonOptions["updateTestSeams"]>;
  clock: { now: number };
  /** The newest version the channel answers; older than the daemon until the test sets it. */
  registry: { latest: string };
  /** How often the channel was asked. */
  asked: { count: number };
}

export function updateCheckRig(): UpdateCheckRig {
  const clock = { now: 1_000 };
  const registry = { latest: "0.0.1" };
  const asked = { count: 0 };
  return {
    clock,
    registry,
    asked,
    seams: {
      service: {
        autoCheck: true,
        now: () => clock.now,
        detectInstallKind: async () => "npm-global",
        fetchLatest: async () => {
          asked.count += 1;
          return registry.latest;
        },
        npmOnPath: async () => true,
        globalFolder: async () => "/fake/npm/root",
        canWriteGlobalFolder: async () => true,
        platform: "linux",
      },
    },
  };
}
