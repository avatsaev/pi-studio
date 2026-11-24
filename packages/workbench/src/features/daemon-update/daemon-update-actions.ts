/**
 * What the update dialog's buttons do, outside React. "Update and restart" asks the daemon to
 * apply; "Retry" first asks it to check again (a `failed` state is replaced by the next check) and
 * applies only when that leaves an update to install. A refusal because an update is already
 * running is not an error: the running update is shown instead (the status is fetched again, in
 * case the broadcast has not reached this client).
 */

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";

/** The SDK members the actions use (`PiStudioClient` satisfies it). */
export interface DaemonUpdateClient {
  getDaemonUpdateStatus(): Promise<DaemonUpdateStatus>;
  checkDaemonUpdate(): Promise<DaemonUpdateStatus>;
  applyDaemonUpdate(): Promise<{ ok: boolean; error?: string }>;
}

const CHECK_ERRORS: Record<string, string> = {
  offline: "Could not reach the npm registry from the daemon's host.",
  bad_answer: "The npm registry gave an answer the daemon could not read.",
};

const REFUSALS: Record<string, string> = {
  not_available: "No newer version is available.",
  cannot_update: "This daemon cannot update itself.",
};

export function refusalText(error: string | undefined): string {
  return (error && REFUSALS[error]) ?? `The daemon refused the update (${error ?? "unknown"}).`;
}

export function checkErrorText(code: string): string {
  return CHECK_ERRORS[code] ?? `The check failed (${code}).`;
}

/**
 * Starts the update. Resolves the text of an error to show, or `null` when the work started, was
 * already running, or a retry's check left nothing to install (the status then says why).
 * `applyStatus` receives every status fetched on the way.
 */
export async function startDaemonUpdate(
  client: DaemonUpdateClient,
  applyStatus: (status: DaemonUpdateStatus) => void,
  options: { check: boolean },
): Promise<string | null> {
  try {
    if (options.check) {
      const status = await client.checkDaemonUpdate();
      applyStatus(status);
      if (status.state.kind !== "available") {
        return status.checkError === undefined ? null : checkErrorText(status.checkError);
      }
    }
    const response = await client.applyDaemonUpdate();
    if (response.ok) return null;
    if (response.error === "in_progress") {
      applyStatus(await client.getDaemonUpdateStatus());
      return null;
    }
    // The status the refusal was based on may be older than ours.
    applyStatus(await client.getDaemonUpdateStatus());
    return refusalText(response.error);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
