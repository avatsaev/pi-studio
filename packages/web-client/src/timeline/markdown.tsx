/**
 * react-markdown + remark-gfm rendering, replacing the POC's CDN `marked` + `innerHTML`
 * (POC_TO_APP_PLAN_UI.md §4.8). Sanitized by default — react-markdown never injects raw HTML.
 * Fenced code blocks highlight asynchronously via Shiki (`highlight.ts`), except `language-
 * mermaid` blocks, which render as a live diagram via `MermaidBlock` below. LaTeX math
 * (`remark-math` + `rehype-katex`, KaTeX's own CSS below) renders inline `$...$` and block
 * `$$...$$`/`\[...\]` — rehype-katex builds real hast nodes, not a raw-HTML string, so it stays
 * compatible with react-markdown's default sanitization.
 *
 * Two entry points, one parser: `Markdown` for text that can no longer change, and
 * `StreamingMarkdown` for a row the model is still writing — same output, but block-by-block so
 * the per-token-delta cost stays off the whole message (`streaming-split.ts`).
 */

import { memo, useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { highlightToHtml } from "./highlight.js";
import { readMermaidThemeVariables } from "./mermaid-theme.js";
import styles from "./markdown.module.css";
import { InlineImage } from "./InlineImage.js";
import { FileLink } from "./FileLink.js";
import { splitStreamingMarkdown } from "./streaming-split.js";

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void highlightToHtml(code, language).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    // Shiki's output is generated HTML from a trusted local highlighter (no user HTML is ever
    // injected) — the only risk is `code`, which Shiki escapes internally before tokenizing.
    return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

type MermaidRenderState =
  | { status: "pending" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

/**
 * Renders a `language-mermaid` fenced block as a live diagram. `mermaid` is dynamically imported
 * — its parser/renderer is a few hundred KB nobody should pay for until a message actually
 * contains a diagram, the same lazy-load rationale as `@molviewer/core`'s vendor chunk.
 * `securityLevel: "strict"` is mermaid's own built-in sanitization of its SVG output; the only
 * untrusted input is `code`, which mermaid parses strictly as diagram syntax, never as HTML —
 * same trust boundary as Shiki's `dangerouslySetInnerHTML` above. Invalid diagram syntax (a model
 * hallucinating mermaid grammar) falls back to the raw fenced code plus mermaid's own error
 * message, rather than losing the rest of the message.
 */
function MermaidBlock({ code }: { code: string }) {
  const [id] = useState(() => `mermaid-${crypto.randomUUID()}`);
  const [state, setState] = useState<MermaidRenderState>({ status: "pending" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: readMermaidThemeVariables(),
          securityLevel: "strict",
          fontFamily: "var(--pi-font-ui)",
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setState({ status: "ready", svg });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to render diagram",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, code]);

  if (state.status === "ready") {
    // mermaid's own SVG output, sanitized by `securityLevel: "strict"` above — not raw user HTML.
    return <div className={styles.mermaid} dangerouslySetInnerHTML={{ __html: state.svg }} />;
  }
  if (state.status === "error") {
    return (
      <div className={styles.mermaidError}>
        <p className={styles.mermaidErrorMessage}>Failed to render diagram: {state.message}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { className?: string };

function CodeRenderer({ className, children, ...rest }: MarkdownCodeProps) {
  const match = /language-(\w+)/.exec(className ?? "");
  const isBlock = Boolean(match);
  const code = String(children).replace(/\n$/, "");
  if (isBlock && match) {
    const language = match[1] ?? "plaintext";
    if (language === "mermaid") return <MermaidBlock code={code} />;
    return <CodeBlock language={language} code={code} />;
  }
  return (
    <code className={styles.inlineCode} {...rest}>
      {children}
    </code>
  );
}

/**
 * `lean` counterpart of `CodeRenderer` for the block a model is still writing: an unclosed fence
 * inside it would otherwise re-tokenize through Shiki (or re-render a half-written mermaid diagram)
 * on every token delta. Highlighting/diagramming happens once the block closes and moves into the
 * immutable half of the split.
 */
function PlainCodeRenderer({ className, children, ...rest }: MarkdownCodeProps) {
  if (/language-(\w+)/.test(className ?? "")) {
    return (
      <pre>
        <code>{String(children).replace(/\n$/, "")}</code>
      </pre>
    );
  }
  return (
    <code className={styles.inlineCode} {...rest}>
      {children}
    </code>
  );
}

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];
/** Lean mode drops KaTeX only: remark-math leaves a half-typed `$…$` as literal TeX, whereas
 * rehype-katex renders it as a red parse error that flickers on every token delta. */
const NO_REHYPE_PLUGINS: never[] = [];

export interface MarkdownProps {
  text: string;
  assetBase?: string | null;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
}

interface MarkdownBodyProps extends MarkdownProps {
  /** Skip the per-delta-expensive renderers (Shiki, mermaid, KaTeX) — see `StreamingMarkdown`. */
  lean?: boolean;
}

/**
 * One parse, no wrapper element (react-markdown yields a fragment, so the blocks land as direct
 * children of the caller's `.prose` container and its `:first-child`/`:last-child` margin resets
 * keep working). Memoized on primitive props alone — this is what makes `StreamingMarkdown`'s
 * completed blocks cost exactly one parse each for the whole turn.
 */
const MarkdownBody = memo(function MarkdownBody({
  text,
  assetBase = null,
  owningPaneId = null,
  workspaceCwd = null,
  lean = false,
}: MarkdownBodyProps) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={lean ? NO_REHYPE_PLUGINS : REHYPE_PLUGINS}
      components={{
        code: lean ? PlainCodeRenderer : CodeRenderer,
        img: (props) => (
          <InlineImage
            {...props}
            assetBase={assetBase}
            owningPaneId={owningPaneId}
            workspaceCwd={workspaceCwd}
          />
        ),
        a: (props) => (
          <FileLink
            {...props}
            assetBase={assetBase}
            owningPaneId={owningPaneId}
            workspaceCwd={workspaceCwd}
          />
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
});

/** Renders finalized assistant/tool markdown text — one parse of the whole thing. */
export function Markdown({ text, assetBase, owningPaneId, workspaceCwd }: MarkdownProps) {
  return (
    <div className={styles.prose}>
      <MarkdownBody
        text={text}
        assetBase={assetBase}
        owningPaneId={owningPaneId}
        workspaceCwd={workspaceCwd}
      />
    </div>
  );
}

/**
 * Live markdown for a row that is still streaming. `splitStreamingMarkdown` separates the blocks
 * that can no longer change from the one being written: each completed block is its own memoized
 * `MarkdownBody` (parsed once, ever), and only the short tail re-parses per token delta — ~0.24ms
 * against the ~9–27ms a full re-parse of a 3.5–10KB message costs (`streaming-split.ts`).
 *
 * `blocks` is append-only, so the array index is a stable identity.
 *
 * The caret is `markdown.module.css`'s `.streaming > :last-child::after` rather than an element,
 * so it sits inline after the last rendered block instead of on a line of its own.
 */
export function StreamingMarkdown({ text, assetBase, owningPaneId, workspaceCwd }: MarkdownProps) {
  const { blocks, tail } = useMemo(() => splitStreamingMarkdown(text), [text]);
  return (
    <div className={`${styles.prose} ${styles.streaming}`}>
      {blocks.map((block, index) => (
        <MarkdownBody
          key={index}
          text={block}
          assetBase={assetBase}
          owningPaneId={owningPaneId}
          workspaceCwd={workspaceCwd}
        />
      ))}
      {tail !== "" && (
        <MarkdownBody
          text={tail}
          lean
          assetBase={assetBase}
          owningPaneId={owningPaneId}
          workspaceCwd={workspaceCwd}
        />
      )}
    </div>
  );
}
