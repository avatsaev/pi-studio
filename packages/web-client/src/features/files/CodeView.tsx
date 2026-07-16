/**
 * CodeView — highlighted file body with a line-number gutter (POC `showFile`/`reloadFileInPanel`,
 * chat.html ~line 812-828, POC_TO_APP_PLAN_UI.md §4.5). Highlights via Shiki (`highlightToHtml`)
 * asynchronously; a plain scrollable `<pre>` renders while highlighting is pending.
 */

import { useEffect, useState } from "react";
import { Spinner } from "../../components/primitives/Spinner.js";
import { highlightToHtml, langFromPath } from "../../timeline/highlight.js";
import styles from "./CodeView.module.css";

export interface CodeViewProps {
  path: string;
  content: string;
}

export function CodeView({ path, content }: CodeViewProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void highlightToHtml(content, langFromPath(path)).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [content, path]);

  const lines = content.split("\n");
  const gutter = lines.map((_, i) => i + 1).join("\n");

  return (
    <div className={styles.lineNumbers}>
      <pre className={styles.gutter}>{gutter}</pre>
      <div className={styles.codeContent}>
        {html ? (
          // Shiki's output is generated HTML from a trusted local highlighter — same pattern as
          // `timeline/markdown.tsx`'s CodeBlock. No user HTML is ever injected here.
          <div className={styles.shikiHost} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className={styles.loading}>
            <Spinner size="sm" />
            <pre>
              <code>{content}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
