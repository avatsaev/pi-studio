import { describe, expect, it } from "vitest";
import { mergeFileTextState, type FileTextMergeInputs } from "./file-text-state.js";

function inputs(overrides: Partial<FileTextMergeInputs> = {}): FileTextMergeInputs {
  return {
    enabled: true,
    download: { isLoading: false, isError: false, error: null, hasObjectUrl: false },
    decode: { isLoading: false, isError: false, error: null, data: undefined },
    ...overrides,
  };
}

describe("mergeFileTextState", () => {
  it("is not loading when disabled, even if the underlying download is in flight", () => {
    const state = mergeFileTextState(
      inputs({ enabled: false, download: { ...inputs().download, isLoading: true } }),
    );
    expect(state.isLoading).toBe(false);
  });

  it("is loading while the download itself is in flight", () => {
    const state = mergeFileTextState(
      inputs({ download: { ...inputs().download, isLoading: true } }),
    );
    expect(state.isLoading).toBe(true);
  });

  it("is loading while the decode is in flight, once an object URL exists", () => {
    const state = mergeFileTextState(
      inputs({
        download: { ...inputs().download, hasObjectUrl: true },
        decode: { ...inputs().decode, isLoading: true },
      }),
    );
    expect(state.isLoading).toBe(true);
  });

  it("is not loading from a stale decode.isLoading before the download has produced an object URL", () => {
    // Guards the dependent-query ordering: `decode`'s queryFn can only run once `download`
    // resolves, but its `isLoading` flag can be `true` before that if TanStack Query considers it
    // "pending" — the merge must gate on `hasObjectUrl`, not trust `decode.isLoading` alone.
    const state = mergeFileTextState(
      inputs({ decode: { ...inputs().decode, isLoading: true } }), // hasObjectUrl still false
    );
    expect(state.isLoading).toBe(false);
  });

  it("surfaces the download's error over the decode's when the download itself failed", () => {
    const downloadError = new Error("download failed");
    const state = mergeFileTextState(
      inputs({
        download: { ...inputs().download, isError: true, error: downloadError },
        decode: { ...inputs().decode, isError: true, error: new Error("decode failed") },
      }),
    );
    expect(state.isError).toBe(true);
    expect(state.error).toBe(downloadError);
  });

  it("surfaces the decode's error when only the decode failed", () => {
    const decodeError = new Error("decode failed");
    const state = mergeFileTextState(
      inputs({ decode: { ...inputs().decode, isError: true, error: decodeError } }),
    );
    expect(state.isError).toBe(true);
    expect(state.error).toBe(decodeError);
  });

  it("passes the decoded content through once available", () => {
    const state = mergeFileTextState(
      inputs({ decode: { ...inputs().decode, data: { content: "hello" } } }),
    );
    expect(state.data).toEqual({ content: "hello" });
  });
});
