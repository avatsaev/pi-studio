/**
 * `use-file-source` — shared three-tier file-source loader for text-shaped viewers (`TextViewer`,
 * `MarkdownFileViewer`, and — sprint-063 task-003 — the HTML viewer).
 *
 * Composes `useFileRead` (tier 1: inline JSON read, capped at the server's
 * `MAX_INLINE_FILE_READ_BYTES`), `useFileText` (tier 2: chunked binary download + UTF-8 decode,
 * for files up to `MAX_DISPLAY_BYTES`), and `useFileDownload` (tier 3: on-demand download-only
 * for anything larger) around the pure, DOM-free tier selector in `text-viewer-state.ts` — the
 * same decision core `TextViewer` used before this hook existed, now shared so every text-shaped
 * viewer gets the same ladder instead of failing outright above the inline cap.
 */

import { useState } from "react";
import {
  selectTextViewerState,
  type TextViewerState,
} from "../features/files/text-viewer-state.js";
import { useFileRead, FileTooLargeError } from "./use-file-read.js";
import { useFileText } from "./use-file-text.js";
import { useFileDownload } from "./use-file-download.js";

/** Display ceiling above the inline cap — see `text-viewer-state.ts`'s doc comment for why. */
export const MAX_DISPLAY_BYTES = 30 * 1024 * 1024;

/** `TextViewerState`, plus a bound `requestDownload()` action on the terminal tier — the hook owns
 *  the `downloadRequested` state the pure selector only reads, so it binds the setter here rather
 *  than making every consumer thread its own `useState` through the selector's inputs. */
export type FileSourceState =
  | Exclude<TextViewerState, { kind: "too-large" }>
  | (Extract<TextViewerState, { kind: "too-large" }> & { requestDownload(): void });

export function useFileSource(path: string, enabled = true): FileSourceState {
  const inline = useFileRead(path, enabled);
  const tooLarge = inline.error instanceof FileTooLargeError ? inline.error : null;
  const displayable = tooLarge !== null && tooLarge.size <= MAX_DISPLAY_BYTES;

  const streamed = useFileText(path, enabled && displayable);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const download = useFileDownload(path, enabled && downloadRequested);

  const state = selectTextViewerState({
    maxDisplayBytes: MAX_DISPLAY_BYTES,
    inline: {
      isLoading: inline.isLoading,
      isError: inline.isError,
      tooLarge: tooLarge ? { size: tooLarge.size } : null,
      errorMessage: inline.error instanceof Error ? inline.error.message : null,
      content: inline.data?.content ?? null,
    },
    streamed: {
      isLoading: streamed.isLoading,
      isError: streamed.isError,
      errorMessage: streamed.error instanceof Error ? streamed.error.message : null,
      content: streamed.data?.content ?? null,
    },
    download: {
      requested: downloadRequested,
      isLoading: download.isLoading,
      objectUrl: download.data?.objectUrl ?? null,
      fileName: download.data?.fileName ?? null,
    },
  });

  if (state.kind === "too-large") {
    return { ...state, requestDownload: () => setDownloadRequested(true) };
  }
  return state;
}
