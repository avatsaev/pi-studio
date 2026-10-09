/**
 * Pure submit gating for the composer (sprint-074), kept out of `Composer.tsx` so the rules are
 * unit-testable. `isComposerBusy` (composer-busy.ts) covers the in-flight RPC flags; this adds the
 * two facts it can't see — a compaction is running, and the draft is a client built-in — plus
 * what happens to a `/compact` draft once the compaction settles.
 */

import type { CompactResult } from "@pi-studio-ui/stores/compaction-store.js";
import { parseBuiltinInvocation } from "./slash-commands.js";

export interface CompactAvailability {
  running: boolean;
  compacting: boolean;
  hasAgent: boolean;
}

/** `/compact` can run only against a live-capable agent that is idle and not already compacting. */
export function canCompact({ running, compacting, hasAgent }: CompactAvailability): boolean {
  return hasAgent && !running && !compacting;
}

/**
 * A `/compact` draft is cleared the moment it is submitted (the RPC resolves only when the
 * compaction ends). It is put back only when nothing was compacted — a refusal or an RPC failure —
 * so a retry is one keystroke. A user cancel is the requested outcome, not something to retry, and
 * a draft written meanwhile (e.g. a `set_editor_text` effect) is never clobbered.
 */
export function shouldRestoreCompactDraft(result: CompactResult, currentDraft: string): boolean {
  return !result.ok && result.reason !== "canceled" && currentDraft === "";
}

export interface SubmitGateInput extends CompactAvailability {
  hasClient: boolean;
  /** `isComposerBusy(...)` — an in-flight send/steer. */
  busy: boolean;
  /** Draft text (untrimmed) — decides whether it is a built-in invocation. */
  text: string;
  hasImages: boolean;
}

/**
 * Whether Send/Enter may act on this draft:
 * - compacting blocks every draft (Pi rejects prompts during compaction);
 * - a `/compact` draft needs `canCompact` — in particular it is never routed to steer while
 *   running, which would send the literal text to the model mid-turn.
 */
export function canSubmitDraft(input: SubmitGateInput): boolean {
  const hasContent = input.text.trim().length > 0 || input.hasImages;
  if (!input.hasClient || !hasContent || input.busy || input.compacting) return false;
  if (parseBuiltinInvocation(input.text) !== null) return canCompact(input);
  return true;
}
