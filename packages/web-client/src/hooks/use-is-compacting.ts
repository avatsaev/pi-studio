/**
 * `useIsCompacting` — true while this session is compacting, from either source: a `started`
 * compaction row in its timeline (`isCompactionPending` — covers automatic compactions and other
 * clients' manual ones, via the stream) or this client's own in-flight compact RPC
 * (`compaction-store`'s local pending flag — the only signal against a daemon without
 * `compactionEvents`). The single selector the meter and composer gate on.
 */

import { useCompactionStore } from "@pi-studio-ui/stores/compaction-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { isCompactionPending } from "@pi-studio-ui/timeline/compaction.js";

export function useIsCompacting(sessionId: string | null): boolean {
  const timelinePending = useSessionStore((s) =>
    sessionId ? isCompactionPending(s.sessions[sessionId]?.timeline.rows ?? []) : false,
  );
  const localPending = useCompactionStore((s) =>
    sessionId ? s.pendingBySession[sessionId] === true : false,
  );
  return timelinePending || localPending;
}
