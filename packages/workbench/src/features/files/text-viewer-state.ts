/**
 * Pure tier-selection logic for `TextViewer` (task-009), kept in its own DOM-free module so the
 * three-state branch (inline / streamed / download-only) is unit-testable without mounting
 * CodeMirror or React — mirrors `molecule-reload.ts`'s `shouldApplyRefresh` extraction for the
 * same reason: this repo has no jsdom test environment configured anywhere.
 */

export type TextViewerState =
  | { kind: "loading" }
  | { kind: "inline"; content: string }
  | { kind: "streaming"; size: number }
  | { kind: "streamed"; size: number; content: string }
  | { kind: "stream-error"; size: number; message: string }
  | {
      kind: "too-large";
      size: number;
      maxDisplayBytes: number;
      downloading: boolean;
      downloadUrl: string | null;
      downloadName: string | null;
    }
  | { kind: "error"; message: string };

export interface TextViewerInputs {
  maxDisplayBytes: number;
  inline: {
    isLoading: boolean;
    isError: boolean;
    /** `{ size }` when the failure was specifically `FileTooLargeError`; `null` for a generic
     *  read failure (network/permission/etc). */
    tooLarge: { size: number } | null;
    errorMessage: string | null;
    content: string | null;
  };
  streamed: {
    isLoading: boolean;
    isError: boolean;
    errorMessage: string | null;
    content: string | null;
  };
  download: {
    requested: boolean;
    isLoading: boolean;
    objectUrl: string | null;
    fileName: string | null;
  };
}

/** Selects exactly one `TextViewerState` from the current query states. Pure — no hooks, no I/O. */
export function selectTextViewerState(input: TextViewerInputs): TextViewerState {
  const { maxDisplayBytes, inline, streamed, download } = input;

  if (inline.isLoading) return { kind: "loading" };

  if (inline.tooLarge) {
    const { size } = inline.tooLarge;
    if (size > maxDisplayBytes) {
      return {
        kind: "too-large",
        size,
        maxDisplayBytes,
        downloading: download.requested && download.isLoading,
        downloadUrl: download.objectUrl,
        downloadName: download.fileName,
      };
    }
    if (streamed.isLoading) return { kind: "streaming", size };
    if (streamed.isError) {
      return { kind: "stream-error", size, message: streamed.errorMessage ?? "stream failed" };
    }
    if (streamed.content !== null) return { kind: "streamed", size, content: streamed.content };
    return { kind: "loading" };
  }

  if (inline.isError) {
    return { kind: "error", message: inline.errorMessage ?? "unknown error" };
  }

  if (inline.content !== null) return { kind: "inline", content: inline.content };
  return { kind: "loading" };
}
