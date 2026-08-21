/**
 * Virtualized timeline viewport — TanStack Virtual over `session.timeline.rows` with
 * variable-size rows (POC `.chat-area`, POC_TO_APP_PLAN_UI.md §4.3/§6).
 *
 * **Following the live agent output is split in two, along the line of what can be done from an
 * effect.** Staying pinned while *existing* content grows — a streamed assistant message appends
 * into the row it already owns, a tool card's output tail grows in place, an image/mermaid/
 * highlighted block resolves late, an estimated row is replaced by its real measured height — has
 * to be corrected inside the virtualizer's own resize handling, before paint; that is exactly what
 * `anchorTo: "end"` does, so it is the library's job and none of this file's. Deciding *whether*
 * the view should be following at all is a user-intent question the library cannot answer, and
 * that is `timeline/bottom-anchor.ts` + `use-bottom-anchor.ts` (one boolean: only a gesture
 * detaches, only proximity to the bottom re-attaches).
 *
 * What is left here is three lines of wiring: follow the tail whenever the row set changes, pin on
 * the user's own new message, and render the jump-to-latest affordance while detached.
 *
 * Note that neither half needs the row *count* diffed across renders. The count-growth heuristic
 * this replaced could not see a streaming row grow (same count, more text — the reported "doesn't
 * follow live output"), and its cross-render tracking ref needed a cleanup that undid itself to
 * survive StrictMode's double-invoke. Re-asserting the bottom is idempotent, so both are gone.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { measureElement as measureElementDefault, useVirtualizer } from "@tanstack/react-virtual";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { useProviderAuthList } from "@pi-studio-ui/hooks/use-provider-auth-list.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { AT_BOTTOM_THRESHOLD_PX, lastRowUserId } from "@pi-studio-ui/timeline/bottom-anchor.js";
import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
import { AskCard, AskMoreRow } from "@pi-studio-ui/features/agent-ui/AskCard.js";
import {
  askEntryKey,
  layoutAskEntries,
  mergeAskEntries,
  type AskEntry,
} from "@pi-studio-ui/features/agent-ui/ask-list.js";
import { placeAsksInRows } from "@pi-studio-ui/features/agent-ui/ask-placement.js";
import {
  useAgentUiPending,
  useAgentUiResolved,
} from "@pi-studio-ui/features/agent-ui/agent-ui-store.js";
import { shouldShowProviderOnboardingNudge } from "./onboarding-nudge.js";
import { AssistantRow } from "./rows/AssistantRow.js";
import { ReasoningRow } from "./rows/ReasoningRow.js";
import { ToolCard } from "./rows/ToolCard.js";
import { UserRow } from "./rows/UserRow.js";
import { ErrorRow } from "./rows/ErrorRow.js";
import { SystemRow } from "./rows/SystemRow.js";
import { useBottomAnchor } from "./use-bottom-anchor.js";
import styles from "./Timeline.module.css";

export interface TimelineProps {
  session: SessionEntry;
  owningPaneId: string | null;
  workspaceCwd: string;
}

/** Median measured row height (rows sampled in a live session ran 51–571px), not a placeholder
 * minimum: every unmeasured row is estimated with this, so the further it sits from reality the
 * further a restored conversation's first jump-to-bottom lands from the real bottom. */
const ESTIMATED_ROW_HEIGHT_PX = 160;

// Extension-UI dialogs (sprint-068/task-005, extended by task-006 for resolved-collapsed and
// task-007 for the past-four collapse) are never persisted `TimelineRow`s — they're composed into
// the virtualized list at render time as a discriminated union alongside it, so the virtualizer
// measures/scrolls them like any other row. `ask-placement.ts` decides *where*: chronologically
// among the rows, trailing only when no row is newer (they were unconditionally appended until a
// real-`pi` turn showed an answered dialog rendering below the reply that consumed it).
// `"ask-more"` is the § 06 "N more waiting" marker `layoutAskEntries` splices into the sequence —
// it carries no dialog identity of its own, so it gets a synthetic, always-unique key rather than
// `askEntryKey`.
type ComposedItem =
  | { kind: "row"; row: TimelineRow }
  | { kind: "ask"; item: AskEntry; collapsed: boolean }
  | { kind: "ask-more"; count: number };

function composedItemKey(item: ComposedItem): string {
  if (item.kind === "ask") return `ask:${askEntryKey(item.item)}`;
  if (item.kind === "ask-more") return "ask-more";
  return item.row.id;
}

function renderRow(
  row: TimelineRow,
  isLast: boolean,
  assetBase: string | null,
  owningPaneId?: string | null,
  workspaceCwd?: string,
) {
  switch (row.kind) {
    case "user":
      return <UserRow row={row} connector={!isLast} />;
    case "assistant":
      return (
        <AssistantRow
          row={row}
          assetBase={assetBase}
          owningPaneId={owningPaneId}
          workspaceCwd={workspaceCwd}
          connector={!isLast}
        />
      );
    case "reasoning":
      return (
        <ReasoningRow
          row={row}
          owningPaneId={owningPaneId}
          workspaceCwd={workspaceCwd}
          connector={!isLast}
        />
      );
    case "tool":
      return (
        <ToolCard
          row={row}
          assetBase={assetBase}
          owningPaneId={owningPaneId}
          workspaceCwd={workspaceCwd}
          connector={!isLast}
        />
      );
    case "error":
      return <ErrorRow row={row} connector={!isLast} />;
    case "system":
      return <SystemRow row={row} />;
  }
}

function renderComposedItem(
  item: ComposedItem,
  isLast: boolean,
  assetBase: string | null,
  owningPaneId: string | null | undefined,
  workspaceCwd: string | undefined,
  onExpandMoreAsks: () => void,
  autoFocusRequestId: string | null,
  sessionTitle: string,
) {
  if (item.kind === "ask")
    return (
      <AskCard
        item={item.item}
        collapsed={item.collapsed}
        connector={!isLast}
        autoFocus={item.item.kind === "pending" && item.item.entry.requestId === autoFocusRequestId}
        sessionTitle={sessionTitle}
      />
    );
  if (item.kind === "ask-more")
    return <AskMoreRow count={item.count} connector={!isLast} onExpand={onExpandMoreAsks} />;
  return renderRow(item.row, isLast, assetBase, owningPaneId, workspaceCwd);
}

export function Timeline({ session, owningPaneId, workspaceCwd }: TimelineProps) {
  const rows = session.timeline.rows;
  const running = session.status === "running";
  const homeDir = useHomeDir();
  const assetBase = normalizeCwd(session.cwd, homeDir);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Extension-UI dialogs for THIS pane's own session/agent only (task-005's "cards render only
  // for the session the pane is showing" — a background session's dialog is invisible until that
  // session is opened, per this sprint's accepted intermediate state). Pending and resolved
  // (collapsed-in-place, task-006) are merged into one ordered list by `mergeAskEntries`, which
  // keeps a card's slot stable across that transition; `layoutAskEntries` (task-007) then applies
  // the § 06 "past four" limit and splices in the "N more waiting" marker. `expandedAsks` is
  // per-pane UI-only state (never persisted, never SDK-derived) — `TabPanelHost` keeps each pane's
  // `Timeline` mounted for the life of its tab, so this naturally resets only when the tab itself
  // is closed and recreated, never on an unrelated re-render. `useAgentUiPending`/
  // `useAgentUiResolved` already return an empty, stable array with no `session.agentId`
  // (deferred-draft chat) or no capability, so no extra gating is needed here.
  const pendingAsks = useAgentUiPending(session.agentId ?? "");
  const resolvedAsks = useAgentUiResolved(session.agentId ?? "");
  const [expandedAsks, setExpandedAsks] = useState(false);
  // § 07 initial focus — "Active session only, first pending card only" — gated on BOTH halves of
  // "a background session or pane never steals focus": the globally active sidebar session, AND
  // this pane being the one that currently owns keystrokes (a pane can show the active session
  // while some *other* pane holds focus — e.g. the user clicked into a terminal). `pendingAsks` is
  // already sorted oldest-first (`pendingForAgent`'s own comparator), so index 0 is exactly the
  // "first pending card" — no re-deriving order here.
  const isActiveSession = useSessionStore((s) => s.activeSessionId === session.id);
  const isFocusedPane = useLayoutStore(
    (s) => s.layouts[workspaceCwd]?.focusedPaneId === owningPaneId,
  );
  const autoFocusRequestId =
    isActiveSession && isFocusedPane ? (pendingAsks[0]?.requestId ?? null) : null;
  const composed: ComposedItem[] = useMemo(() => {
    const askLayout = layoutAskEntries(mergeAskEntries(pendingAsks, resolvedAsks), expandedAsks);
    return placeAsksInRows<ComposedItem>(
      rows,
      askLayout,
      (row) => ({ kind: "row", row }),
      (layoutItem) =>
        layoutItem.kind === "more"
          ? { kind: "ask-more", count: layoutItem.count }
          : { kind: "ask", item: layoutItem.item, collapsed: layoutItem.collapsed },
    );
  }, [rows, pendingAsks, resolvedAsks, expandedAsks]);

  // Onboarding nudge (sprint-065/task-006): the empty-timeline slot doubles as the "you have no
  // model provider configured" affordance. Mirrors `ConnectionBar`'s own capability check — see
  // its comment for why `serverInfo` (a tracked field) is read reactively here instead of the
  // imperative `client.hasProviderAuthCapability()`.
  const connectionOpen = useConnectionStore((s) => s.status === "open");
  const serverInfo = useConnectionStore((s) => s.serverInfo);
  const providerAuthCapable = Boolean(serverInfo?.features?.["providerAuth"]);
  const openSettings = useUiStore((s) => s.openSettings);
  // Gated on capability so a daemon without the feature never sees this RPC issued from this
  // path; gated on `rows.length === 0` because that is the only state this nudge can ever show
  // in, keeping the query idle for the rest of a conversation's lifetime.
  const { data: providersForNudge } = useProviderAuthList(
    rows.length === 0 && connectionOpen && providerAuthCapable,
  );
  const showOnboardingNudge = shouldShowProviderOnboardingNudge(
    providerAuthCapable,
    providersForNudge,
  );

  const virtualizer = useVirtualizer({
    count: composed.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => {
      const item = composed[index];
      return item ? composedItemKey(item) : index;
    },
    // `TabPanelHost` keeps inactive chat tabs mounted under `display:none` rather than
    // unmounting them (so switching tabs preserves scroll position — see its own doc comment).
    // But a `display:none` ancestor collapses every row to a 0×0 border box, and the default
    // `measureElement` would cache that bogus 0 height — shrinking `.inner`'s total height to
    // ~0 and permanently clamping the scroll container's `scrollTop` to 0 in the process, which
    // survives the tab becoming visible again (the browser never un-clamps a scroll offset just
    // because content grows back). Skip the measurement while hidden and keep whatever size is
    // already cached (or the `estimateSize` default on first mount) instead.
    measureElement: (element, entry, instance) => {
      if ((element as HTMLElement).offsetParent !== null)
        return measureElementDefault(element, entry, instance);
      const index = instance.indexFromElement(element);
      const key = instance.options.getItemKey(index);
      return instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index);
    },
    // Keeps the view pinned to the bottom through every change that is NOT a new row: streamed
    // text appended into the assistant row that already exists, a tool card's growing output
    // tail, a late image/mermaid/highlight resolve, and — the one that made restored
    // conversations open mid-history — an estimated height being replaced by its real measured
    // one. All of those must be compensated inside `resizeItem`, before paint; an effect only
    // ever sees them after the fact, which is why this cannot be app code.
    anchorTo: "end",
    // Same number the controller detaches/re-attaches on, so "at the end" means one thing here.
    scrollEndThreshold: AT_BOTTOM_THRESHOLD_PX,
  });

  const { pinned, followTail, pinToBottom } = useBottomAnchor(virtualizer, scrollRef);
  // A trailing user row is the user's own brand-new message (`Composer`'s optimistic echo): always
  // pull back to it, even from a detached state.
  const trailingUserRowId = lastRowUserId(rows);

  useEffect(() => {
    followTail();
  }, [composed.length, followTail]);

  useEffect(() => {
    if (trailingUserRowId !== null) pinToBottom();
  }, [trailingUserRowId, pinToBottom]);

  return (
    <div className={styles.root}>
      {/* One scroller for both states, never a conditional element: swapping it out would detach
          and re-attach the virtualizer (and its listeners) on the first message of a chat. */}
      <div className={styles.viewport} ref={scrollRef}>
        {composed.length === 0 ? (
          !running &&
          (showOnboardingNudge ? (
            <EmptyState className={styles.nudge}>
              <span>No messages yet — connect a model provider to get started.</span>
              <Button size="xs" variant="secondary" onClick={() => openSettings()}>
                Connect a model provider
              </Button>
            </EmptyState>
          ) : (
            <div className={styles.empty}>No messages yet — say something to start.</div>
          ))
        ) : (
          <div className={styles.inner} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = composed[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className={styles.rowWrap}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderComposedItem(
                    item,
                    virtualRow.index === composed.length - 1,
                    assetBase,
                    owningPaneId,
                    workspaceCwd,
                    () => setExpandedAsks(true),
                    autoFocusRequestId,
                    session.title,
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!pinned && composed.length > 0 && (
        <button
          type="button"
          className={styles.jumpToLatest}
          onClick={pinToBottom}
          title="Jump to latest"
          aria-label="Jump to latest"
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
