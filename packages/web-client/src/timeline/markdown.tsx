/**
 * react-markdown + remark-gfm rendering, replacing the POC's CDN `marked` + `innerHTML`
 * (POC_TO_APP_PLAN_UI.md §4.8). Sanitized by default — react-markdown never injects raw HTML.
 * Fenced code blocks highlight asynchronously via Shiki (`highlight.ts`).
 */

import { memo, useEffect, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightToHtml } from "./highlight.js";
import styles from "./markdown.module.css";
import { InlineImage } from "./InlineImage.js";
import { FileLink } from "./FileLink.js";

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

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { className?: string };

function CodeRenderer({ className, children, ...rest }: MarkdownCodeProps) {
  const match = /language-(\w+)/.exec(className ?? "");
  const isBlock = Boolean(match);
  const code = String(children).replace(/\n$/, "");
  if (isBlock && match) {
    return <CodeBlock language={match[1] ?? "plaintext"} code={code} />;
  }
  return (
    <code className={styles.inlineCode} {...rest}>
      {children}
    </code>
  );
}

export interface MarkdownProps {
  text: string;
  assetBase?: string | null;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
}

/** Renders assistant/tool markdown text. Memoized — text is immutable once a turn finalizes. */
export const Markdown = memo(function Markdown({
  text,
  assetBase = null,
  owningPaneId = null,
  workspaceCwd = null,
}: MarkdownProps) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeRenderer,
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
    </div>
  );
});
