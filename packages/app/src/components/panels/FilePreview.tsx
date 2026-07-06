/**
 * FilePreviewPane — renders file content by kind (code, markdown, image, binary).
 * feature-panels-ui.md § file preview pane
 */

import { useMemo, useRef, useEffect } from "react";
import { FileX } from "lucide-react";
import styles from "./FilePreview.module.css";
import { Spinner } from "../primitives/index.js";
import {
  type FilePreviewState,
  type LineHighlight,
  shouldScrollToLine,
  filePreviewTabLabel,
} from "../../panels/file-preview.js";

export interface FilePreviewProps {
  state: FilePreviewState;
}

export function FilePreviewPane({ state }: FilePreviewProps) {
  if (state.status === "loading") {
    return (
      <div className={styles.container}>
        <div className={styles.stateView}><Spinner size="md" /></div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={styles.container}>
        <div className={styles.stateView}>
          <FileX size={24} />
          <span>{state.message}</span>
        </div>
      </div>
    );
  }

  const label = filePreviewTabLabel(state.path);

  switch (state.kind) {
    case "code":
      return (
        <div className={styles.container}>
          <div className={styles.header}>{label} · {state.language}</div>
          <div className={styles.body}>
            <CodeView content={state.content} lineHighlight={state.lineHighlight} lineCount={state.lineCount} />
          </div>
        </div>
      );
    case "markdown":
      return (
        <div className={styles.container}>
          <div className={styles.header}>{label}</div>
          <div className={styles.body}>
            <div className={styles.markdownView}>{state.content}</div>
          </div>
        </div>
      );
    case "image":
      return (
        <div className={styles.container}>
          <div className={styles.header}>{label}</div>
          <div className={styles.imageView}>
            <img src={state.resolvedUrl} alt={label} />
          </div>
        </div>
      );
    case "binary":
      return (
        <div className={styles.container}>
          <div className={styles.stateView}>
            <FileX size={24} />
            <span>Binary file{state.size ? ` (${formatBytes(state.size)})` : ""}</span>
          </div>
        </div>
      );
  }
}

function CodeView({ content, lineHighlight, lineCount }: { content: string; lineHighlight?: LineHighlight; lineCount: number }) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lineHighlight && scrollRef.current) {
      const el = scrollRef.current.querySelector(`[data-line="${lineHighlight.lineStart}"]`);
      el?.scrollIntoView({ block: "center" });
    }
  }, [lineHighlight]);

  return (
    <div className={styles.codeView} ref={scrollRef}>
      <div className={styles.gutter}>
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className={styles.codeContent}>
        {lines.map((line, i) => {
          const lineNum = i + 1;
          const highlighted = lineHighlight &&
            lineNum >= lineHighlight.lineStart &&
            lineNum <= (lineHighlight.lineEnd ?? lineHighlight.lineStart);
          return (
            <div key={i} data-line={lineNum} className={highlighted ? styles.lineHighlight : undefined}>
              {line || "\u00a0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
