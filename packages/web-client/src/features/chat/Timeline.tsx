/**
 * Virtualized timeline viewport — TanStack Virtual over `session.timeline.rows` with
 * variable-size rows (POC `.chat-area`, POC_TO_APP_PLAN_UI.md §4.3/§6). Auto-scrolls to the
 * bottom on new rows unless the user has scrolled up more than 40px from the bottom; re-sticks
 * whenever the row count grows from a user's own send (POC's forced `scrollTop = scrollHeight`,
 * fixed to respect manual scroll-up). The mount-time "grew" tracking ref reverts itself on
 * cleanup — required for correctness under React StrictMode's dev-only double-invoke, which
 * otherwise swallows the necessary scroll-to-bottom on a freshly restored/opened session (see
 * the effect's own comment).
 */

import { useEffect, useRef } from "react";
import { measureElement as measureElementDefault, useVirtualizer } from "@tanstack/react-virtual";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
import { AssistantRow } from "./rows/AssistantRow.js";
import { ReasoningRow } from "./rows/ReasoningRow.js";
import { ToolCard } from "./rows/ToolCard.js";
import { UserRow } from "./rows/UserRow.js";
import { ErrorRow } from "./rows/ErrorRow.js";
import { SystemRow } from "./rows/SystemRow.js";
import styles from "./Timeline.module.css";

export interface TimelineProps {
  session: SessionEntry;
}

const STICK_THRESHOLD_PX = 40;

function renderRow(row: TimelineRow) {
  switch (row.kind) {
    case "user":
      return <UserRow row={row} />;
    case "assistant":
      return <AssistantRow row={row} />;
    case "reasoning":
      return <ReasoningRow row={row} />;
    case "tool":
      return <ToolCard row={row} />;
    case "error":
      return <ErrorRow row={row} />;
    case "system":
      return <SystemRow row={row} />;
  }
}

export function Timeline({ session }: TimelineProps) {
  const rows = session.timeline.rows;
  const running = session.status === "running";
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // Init to 0 (not `rows.length`) so a freshly-mounted tab with existing history — a brand-new
  // chat tab switch or a session restored from disk — still counts as "grew" on its first effect
  // run and scrolls to the last message, instead of opening at the top.
  const prevRowCountRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
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
      if ((element as HTMLElement).offsetParent !== null) return measureElementDefault(element, entry, instance);
      const index = instance.indexFromElement(element);
      const key = instance.options.getItemKey(index);
      return instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index);
    },
  });

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < STICK_THRESHOLD_PX;
  }

  useEffect(() => {
    const prevCount = prevRowCountRef.current;
    const grew = rows.length > prevCount;
    prevRowCountRef.current = rows.length;
    if (grew && stickToBottomRef.current) {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    }
    // React StrictMode double-invokes this effect on mount (mount -> phantom cleanup -> mount,
    // same instance — see TerminalPanel.tsx's own StrictMode doc comment for the established
    // pattern here). `@tanstack/react-virtual`'s own scroll-element attachment effect DOES
    // correctly redo its setup across that phantom cycle and, in doing so, resets the DOM
    // `scrollTop` back to 0 on the second (real) attach — but without this cleanup, this ref's
    // `grew` flip from the first (phantom) invocation would make the second invocation a false
    // "unchanged" no-op, permanently losing the scroll-to-bottom to the library's reset and
    // leaving a freshly restored/opened session's timeline stuck at the top. Reverting the ref
    // on cleanup makes each real invocation see the true count it started from.
    return () => {
      prevRowCountRef.current = prevCount;
    };
  }, [rows.length, virtualizer]);

  if (rows.length === 0) {
    return (
      <div className={styles.viewport} ref={scrollRef}>
        {running ? (
          <div className={styles.working} role="status" aria-live="polite">
            <span className={styles.workingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Agent is working…
          </div>
        ) : (
          <div className={styles.empty}>No messages yet — say something to start.</div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.viewport} ref={scrollRef} onScroll={handleScroll}>
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
              {renderRow(row)}
            </div>
          );
        })}
      </div>
      {running && (
        <div className={styles.working} role="status" aria-live="polite">
          <span className={styles.workingDots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Agent is working…
        </div>
      )}
    </div>
  );
}
