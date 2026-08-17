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

import { useEffect, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { measureElement as measureElementDefault, useVirtualizer } from "@tanstack/react-virtual";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { AT_BOTTOM_THRESHOLD_PX, lastRowUserId } from "@pi-studio-ui/timeline/bottom-anchor.js";
import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
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

export function Timeline({ session, owningPaneId, workspaceCwd }: TimelineProps) {
  const rows = session.timeline.rows;
  const running = session.status === "running";
  const homeDir = useHomeDir();
  const assetBase = normalizeCwd(session.cwd, homeDir);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
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
  }, [rows.length, followTail]);

  useEffect(() => {
    if (trailingUserRowId !== null) pinToBottom();
  }, [trailingUserRowId, pinToBottom]);

  return (
    <div className={styles.root}>
      {/* One scroller for both states, never a conditional element: swapping it out would detach
          and re-attach the virtualizer (and its listeners) on the first message of a chat. */}
      <div className={styles.viewport} ref={scrollRef}>
        {rows.length === 0 ? (
          !running && <div className={styles.empty}>No messages yet — say something to start.</div>
        ) : (
          <div className={styles.inner} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className={styles.rowWrap}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderRow(
                    row,
                    virtualRow.index === rows.length - 1,
                    assetBase,
                    owningPaneId,
                    workspaceCwd,
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!pinned && rows.length > 0 && (
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
