/**
 * Virtualized timeline viewport — TanStack Virtual over `session.timeline.rows` with
 * variable-size rows (POC `.chat-area`, POC_TO_APP_PLAN_UI.md §4.3/§6). Auto-scrolls to the
 * bottom on new rows unless the user has scrolled up more than 40px from the bottom; re-sticks
 * whenever the row count grows from a user's own send (POC's forced `scrollTop = scrollHeight`,
 * fixed to respect manual scroll-up).
 */

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  const prevRowCountRef = useRef(rows.length);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < STICK_THRESHOLD_PX;
  }

  useEffect(() => {
    const grew = rows.length > prevRowCountRef.current;
    prevRowCountRef.current = rows.length;
    if (!grew) return;
    if (!stickToBottomRef.current) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
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
