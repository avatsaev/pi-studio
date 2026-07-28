/**
 * Pure query-state merge for `use-file-text` (task-009), kept DOM/React-free so the
 * loading/error/data composition across the two dependent queries it wraps (download → decode)
 * is unit-testable directly, without `renderHook` (no jsdom test environment in this repo).
 */

export interface FileTextResult {
  content: string;
}

export interface FileTextMergeInputs {
  enabled: boolean;
  download: { isLoading: boolean; isError: boolean; error: unknown; hasObjectUrl: boolean };
  decode: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data: FileTextResult | undefined;
  };
}

export interface FileTextQueryState {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: FileTextResult | undefined;
}

export function mergeFileTextState(input: FileTextMergeInputs): FileTextQueryState {
  const { enabled, download, decode } = input;
  return {
    isLoading: enabled && (download.isLoading || (download.hasObjectUrl && decode.isLoading)),
    isError: download.isError || decode.isError,
    error: download.isError ? download.error : decode.error,
    data: decode.data,
  };
}
