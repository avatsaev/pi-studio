/**
 * Timeline — virtualized chat timeline list.
 * Driven by sprint-015 render model, row dispatch, autoscroll.
 * timeline-rendering.md § List, § Autoscroll
 */

import { useRef, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import styles from "./Timeline.module.css";
import {
  buildRenderItems,
  type RenderItem,
} from "../../timeline/render-model.js";
import {
  dispatchRow,
  resolveRowGap,
  TIMELINE_MAX_CONTENT_WIDTH,
} from "../../timeline/row-dispatch.js";
import {
  onScroll,
  onRowsAdded,
  onJumpToBottom,
  onScrollComplete,
  NEAR_BOTTOM_THRESHOLD_PX,
  type AutoscrollState,
  INITIAL_AUTOSCROLL_STATE,
} from "../../timeline/autoscroll.js";
import type { TimelineRow } from "../../timeline/reducer.js";

// ---------------------------------------------------------------------------
// Row renderer registry (open for registration by tasks 002–003)
// ---------------------------------------------------------------------------

export type RowRendererFn = (item: RenderItem) => ReactNode;

const PLACEHOLDER_RENDERER: RowRendererFn = (item) => (
  <div className={styles.placeholder}>
    [{item.row.kind}] row {item.row.rowId}
  </div>
);

/** Registry of concrete row renderers. Populated by message/tool/diff tasks. */
const rowRendererRegistry = new Map<string, RowRendererFn>();

export function registerRowRenderer(kind: string, renderer: RowRendererFn): void {
  rowRendererRegistry.set(kind, renderer);
}

function getRowRenderer(kind: string): RowRendererFn {
  return rowRendererRegistry.get(kind) ?? PLACEHOLDER_RENDERER;
}

// ---------------------------------------------------------------------------
// Timeline component
// ---------------------------------------------------------------------------

export interface TimelineProps {
  rows: readonly TimelineRow[];
  /** Called when the user scrolls near the top (paging older history). */
  onLoadOlder?: () => void;
  /** Whether older history is loading. */
  loadingOlder?: boolean;
}

export function Timeline({ rows, onLoadOlder, loadingOlder }: TimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [autoscroll, setAutoscroll] = useState<AutoscrollState>(INITIAL_AUTOSCROLL_STATE);

  const items = useMemo(() => buildRenderItems(rows), [rows]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  // Autoscroll on new rows
  const prevCountRef = useRef(items.length);
  useEffect(() => {
    if (items.length > prevCountRef.current) {
      const result = onRowsAdded(autoscroll);
      if (result.shouldScroll) {
        scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
      }
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  // Scroll handler
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoscroll((prev) => onScroll(prev, distanceFromBottom));

    // Page older history
    if (el.scrollTop < 200 && onLoadOlder && !loadingOlder) {
      onLoadOlder();
    }
  }, [onLoadOlder, loadingOlder]);

  // Jump to latest
  const handleJump = useCallback(() => {
    const result = onJumpToBottom(autoscroll);
    setAutoscroll(result);
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    setTimeout(() => setAutoscroll((s) => onScrollComplete(s)), 300);
  }, [autoscroll]);

  return (
    <div className={styles.container}>
      <div
        ref={scrollerRef}
        className={styles.scroller}
        onScroll={handleScroll}
      >
        <div
          className={styles.virtualList}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const item = items[vItem.index]!;
            const renderer = getRowRenderer(item.row.kind);
            const gap = resolveRowGap(
              item.row.kind,
              items[vItem.index + 1]?.row.kind,
            );

            return (
              <div
                key={item.key}
                className={styles.row}
                style={{
                  transform: `translateY(${vItem.start}px)`,
                  paddingBottom: gap,
                }}
                ref={virtualizer.measureElement}
                data-index={vItem.index}
              >
                <div className={styles.rowContent}>
                  {renderer(item)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Jump to latest button */}
      {autoscroll.showJumpButton && (
        <button className={styles.jumpBtn} onClick={handleJump}>
          <ArrowDown size={12} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
