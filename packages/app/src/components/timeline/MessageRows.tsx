/**
 * Message row renderers — user bubble, assistant markdown, activity pills.
 * timeline-rendering.md § Message rows, § Markdown
 */

import { useMemo, useState, useCallback } from "react";
import { clsx } from "clsx";
import { Copy, Check } from "lucide-react";
import styles from "./MessageRows.module.css";
import { registerRowRenderer, type RowRendererFn } from "./Timeline.js";
import { parseMarkdownBlocks, type MarkdownBlock } from "../../timeline/markdown.js";
import { detectInlinePathLinks } from "../../timeline/file-links.js";
import { buildCodeBlock } from "../../timeline/code-block.js";
import { tokenColorVar } from "../../timeline/syntax-highlight.js";
import { STREAM_CURSOR } from "../../timeline/streaming.js";
import { buildThinkingCard, thinkingLabel } from "../../timeline/thinking.js";
import { buildCompactionMarker } from "../../timeline/compaction.js";
import type { RenderItem } from "../../timeline/render-model.js";

// ---------------------------------------------------------------------------
// Markdown renderer (streaming-safe)
// ---------------------------------------------------------------------------

function MarkdownContent({ text, onFileClick }: { text: string; onFileClick?: (path: string) => void }) {
  const parsed = useMemo(() => parseMarkdownBlocks(text), [text]);

  return (
    <div className={styles.assistantContent}>
      {parsed.blocks.map((block) => (
        <MarkdownBlockView key={block.id} block={block} onFileClick={onFileClick} />
      ))}
    </div>
  );
}

function MarkdownBlockView({ block, onFileClick }: { block: MarkdownBlock; onFileClick?: (path: string) => void }) {
  switch (block.kind) {
    case "heading": {
      const level = block.level;
      if (level === 1) return <h1>{block.text}</h1>;
      if (level === 2) return <h2>{block.text}</h2>;
      if (level === 3) return <h3>{block.text}</h3>;
      return <h4>{block.text}</h4>;
    }
    case "paragraph":
      return <p><InlineText text={block.text} onFileClick={onFileClick} /></p>;
    case "code_block":
      return <CodeBlockView language={block.language} code={block.code} />;
    case "bullet_list":
      return <ul>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
    case "ordered_list":
      return <ol start={block.start}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ol>;
    case "blockquote":
      return <blockquote style={{ borderLeft: "3px solid var(--pi-color-border)", paddingLeft: 12, margin: "4px 0", color: "var(--pi-color-foregroundMuted)" }}>{block.text}</blockquote>;
    case "rule":
      return <hr style={{ border: "none", borderTop: "1px solid var(--pi-color-border)", margin: "8px 0" }} />;
    case "image":
      return <img src={block.src} alt={block.alt} style={{ maxWidth: "100%", borderRadius: 4 }} />;
    default:
      return null;
  }
}

function InlineText({ text, onFileClick }: { text: string; onFileClick?: (path: string) => void }) {
  const links = useMemo(() => detectInlinePathLinks(text), [text]);
  if (links.length === 0) return <>{text}</>;

  // Highlight detected file paths
  let remaining = text;
  const parts: React.ReactNode[] = [];
  for (const link of links) {
    const idx = remaining.indexOf(link.raw);
    if (idx > 0) parts.push(remaining.slice(0, idx));
    parts.push(
      <span key={parts.length} className={styles.fileLink} onClick={() => {
        if (link.target.kind === "file" || link.target.kind === "directory") onFileClick?.(link.target.path);
      }}>
        {link.raw}
      </span>,
    );
    remaining = remaining.slice(idx + link.raw.length);
  }
  if (remaining) parts.push(remaining);
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// Row renderers
// ---------------------------------------------------------------------------

const UserMessageRow: RowRendererFn = (item) => {
  const payload = item.row.payload as { text?: string; optimistic?: boolean } | undefined;
  return (
    <div className={styles.userMessage}>
      <div className={clsx(styles.userBubble, payload?.optimistic && styles.userBubbleOptimistic)}>
        {payload?.text ?? ""}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Syntax-highlighted code block with hover copy button
// ---------------------------------------------------------------------------

function CodeBlockView({ language, code }: { language: string; code: string }) {
  const model = useMemo(() => buildCodeBlock(code, language), [code, language]);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeBlockHeader}>
        <span>{model.language || "text"}</span>
        <button type="button" className={styles.copyBtn} aria-label="Copy code" onClick={onCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre>
        <code>
          {model.lines.map((line) => (
            <div key={line.lineIndex} className={styles.codeLine}>
              {line.spans.map((span, i) => (
                <span key={i} style={{ color: tokenColorVar(span.type) }}>{span.value}</span>
              ))}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

const AssistantMessageRow: RowRendererFn = (item) => {
  const payload = item.row.payload as { text?: string; delta?: string; streaming?: boolean; status?: string } | undefined;
  const streaming = payload?.streaming === true || payload?.status === "streaming";
  return (
    <div className={styles.assistantMessage}>
      <MarkdownContent text={payload?.text ?? ""} />
      {streaming && <span className={styles.streamCursor} aria-hidden="true">{STREAM_CURSOR}</span>}
    </div>
  );
};

const ActivityLogPill: RowRendererFn = (item) => {
  const payload = item.row.payload as { activityType?: string; message?: string } | undefined;
  const tone = payload?.activityType;
  return (
    <div
      className={clsx(
        styles.activityPill,
        tone === "error" && styles.activityError,
        tone === "success" && styles.activitySuccess,
      )}
    >
      {payload?.message ?? "Activity"}
    </div>
  );
};

const CompactionMarker: RowRendererFn = (item) => {
  const p = item.row.payload as {
    status?: "loading" | "completed";
    trigger?: "automatic" | "manual";
    preTokens?: number;
    summarizedTurns?: number;
  } | undefined;
  const model = buildCompactionMarker({
    status: p?.status ?? "completed",
    trigger: p?.trigger,
    preTokens: p?.preTokens,
    summarizedTurns: p?.summarizedTurns,
  });
  return <div className={styles.compaction}>✂ {model.label}</div>;
};

const ThinkingCard: RowRendererFn = (item) => {
  const payload = item.row.payload as {
    text?: string;
    status?: string;
    startedAt?: number;
    responseStarted?: boolean;
  } | undefined;
  const active = payload?.status === "loading" || payload?.status === "streaming";
  const model = buildThinkingCard({
    text: payload?.text ?? "",
    active,
    startedAt: payload?.startedAt ?? Date.now(),
    now: Date.now(),
    responseStarted: payload?.responseStarted ?? false,
  });
  return (
    <div className={styles.assistantMessage}>
      <div className={clsx(styles.thinkingLabel, model.shimmer && styles.thinkingShimmer)}>
        {thinkingLabel(model)}
      </div>
      {!model.collapsed && model.text && (
        <div className={styles.thinkingBody}>
          <MarkdownContent text={model.text} />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Register all message-kind renderers
// ---------------------------------------------------------------------------

registerRowRenderer("user_message", UserMessageRow);
registerRowRenderer("assistant_message", AssistantMessageRow);
registerRowRenderer("activity_log", ActivityLogPill);
registerRowRenderer("compaction", CompactionMarker);
registerRowRenderer("thought", ThinkingCard);

export { UserMessageRow, AssistantMessageRow, ActivityLogPill, CompactionMarker, ThinkingCard, MarkdownContent };
