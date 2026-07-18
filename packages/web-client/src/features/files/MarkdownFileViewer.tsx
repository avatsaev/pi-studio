/**
 * MarkdownFileViewer — renders a `.md`/`.mdx` file's content through the app's sanitized
 * Markdown renderer (`timeline/markdown.tsx`, react-markdown + remark-gfm — no
 * `dangerouslySetInnerHTML` of user content), with a Preview/Source toggle since raw markdown is
 * sometimes what you actually want to read (POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular file
 * preview).
 */

import { useState } from "react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileRead } from "@pi-studio-ui/hooks/use-file-read.js";
import { Markdown } from "@pi-studio-ui/timeline/markdown.js";
import { CodeView } from "./CodeView.js";
import type { ViewerProps } from "./viewer-registry.js";
import panelStyles from "./FilePanel.module.css";
import styles from "./MarkdownFileViewer.module.css";

type Mode = "preview" | "source";

export function MarkdownFileViewer({ path }: ViewerProps) {
  const query = useFileRead(path);
  const [mode, setMode] = useState<Mode>("preview");

  if (query.isLoading) {
    return (
      <div className={panelStyles.emptyState}>
        <Spinner size="sm" /> Loading...
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={panelStyles.emptyState}>
        Error: {query.error instanceof Error ? query.error.message : "unknown error"}
      </div>
    );
  }
  if (!query.data) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <Button size="xs" variant={mode === "preview" ? "default" : "ghost"} onClick={() => setMode("preview")}>
          Preview
        </Button>
        <Button size="xs" variant={mode === "source" ? "default" : "ghost"} onClick={() => setMode("source")}>
          Source
        </Button>
      </div>
      {mode === "preview" ? (
        <div className={styles.rendered}>
          <Markdown text={query.data.content} />
        </div>
      ) : (
        <CodeView path={path} content={query.data.content} />
      )}
    </div>
  );
}
