/**
 * What Settings → Daemon's two controls do, outside React. "Check now" asks the daemon to check
 * npm; a failed check is not an error here — it is in the answer's `checkError`, which the view
 * shows in words — so only a request that itself failed resolves a message. The automatic-check
 * switch is optimistic: the new value is shown at once and given up again (never flipped back from
 * a guess) when the request fails.
 */

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";

/** The SDK members the controls use (`PiStudioClient` satisfies it). */
export interface DaemonSettingsClient {
  checkDaemonUpdate(): Promise<DaemonUpdateStatus>;
  setDaemonUpdateAutoCheck(enabled: boolean): Promise<DaemonUpdateStatus>;
}

/** Resolves the text of an error to show, or `null`. `applyStatus` receives the answer. */
export async function checkDaemonNow(
  client: DaemonSettingsClient,
  applyStatus: (status: DaemonUpdateStatus) => void,
): Promise<string | null> {
  try {
    applyStatus(await client.checkDaemonUpdate());
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Sets the switch. `setPending(enabled)` shows the new value while the request is out;
 * `setPending(null)` ends it — after the answer is applied (which carries the daemon's own value),
 * or after a failure, which is how the switch reverts. Resolves the text of an error to show.
 */
export async function changeAutoCheck(
  client: DaemonSettingsClient,
  enabled: boolean,
  hooks: {
    applyStatus: (status: DaemonUpdateStatus) => void;
    setPending: (value: boolean | null) => void;
  },
): Promise<string | null> {
  hooks.setPending(enabled);
  try {
    hooks.applyStatus(await client.setDaemonUpdateAutoCheck(enabled));
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Could not change the automatic check: ${reason}`;
  } finally {
    hooks.setPending(null);
  }
}
