/**
 * Fork completion — how a settled `fork(entryId)` RPC is applied (sprint-072/task-004). The RPC
 * response does only two things: close the dialog and prefill the composer; the timeline refresh
 * deliberately rides task-001's `agent_timeline_reset` broadcast handler instead — there is no
 * bespoke path here for the requester, so the initiating tab, a second browser window, and a
 * relay-connected phone all converge identically (special-casing the requester would recreate
 * exactly the divergence the broadcast design exists to prevent).
 *
 * Split out of `ForkDialog.tsx` so these decisions are testable without mounting the dialog —
 * each function reads/writes the relevant stores directly via `.getState()`, the same imperative
 * pattern `agent-ui-store.ts`'s `composerTextEffect` already uses for the equivalent
 * `replace_composer_text` effect.
 */

import { clearWhenIdle } from "@pi-studio-ui/stores/announcer-store.js";
import { useDraftStore } from "@pi-studio-ui/stores/draft-store.js";
import { useForkStore } from "@pi-studio-ui/stores/fork-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useToastStore } from "@pi-studio-ui/stores/toast-store.js";

/** § 12 copy deck — shipped verbatim. */
export const FORK_DECLINED_TOAST = "An extension declined the fork.";
/** § 12's "generic" toast row — the fallback when a caught error carries no readable message. */
export const FORK_GENERIC_ERROR_TOAST = "Couldn't fork. Try again.";

/**
 * Applies a resolved (non-throwing) `fork()` result.
 *
 * - `cancelled` (a `session_before_fork` extension handler declined it): toast the § 12 copy,
 *   close the dialog, change nothing else — no `agent_timeline_reset` arrives, and none should be
 *   expected. The toast's own `role="status"`/`aria-live="polite"` region (`ToastViewport.tsx`)
 *   is the resolution announcement here — `clearWhenIdle` below only ends the "Forking…" pending
 *   announcement (§ 11) spoken when the confirm step's RPC was fired; it never speaks a second,
 *   redundant one.
 * - Otherwise: close the dialog, then write `text` into the FORKED session's own draft — resolved
 *   by `agentId` via `session-store`'s `findByAgentId`, never "whichever composer has focus" (the
 *   `agent-ui-store.ts` precedent for `replace_composer_text`) — but only when that draft is
 *   empty. A user's in-progress draft is never clobbered, and the skip is silent (no toast).
 */
export function applyForkSuccess(
  agentId: string,
  result: { text: string; cancelled: boolean },
): void {
  clearWhenIdle();
  if (result.cancelled) {
    useToastStore.getState().error(FORK_DECLINED_TOAST);
    useForkStore.getState().close();
    return;
  }
  useForkStore.getState().close();
  const session = useSessionStore.getState().findByAgentId(agentId);
  if (!session) return; // Nothing left to prefill into — the tab that owned this fork is gone.
  const draftIsEmpty = (useDraftStore.getState().drafts[session.id] ?? "") === "";
  if (draftIsEmpty) useDraftStore.getState().setDraft(session.id, result.text);
}

/**
 * Applies a `fork()` rejection (`rpc_error` — e.g. Pi's unsaved-session error, or an unknown/stale
 * `entryId`): toast the daemon's own message (its own aria-live region is the announcement, same
 * rationale as the `cancelled` branch above) and return the dialog to a reusable, non-pending
 * state rather than closing it, so a retry needs no reopening.
 */
export function applyForkError(error: unknown): void {
  clearWhenIdle();
  const message =
    error instanceof Error && error.message ? error.message : FORK_GENERIC_ERROR_TOAST;
  useToastStore.getState().error(message);
  useForkStore.getState().setPending(false);
}
