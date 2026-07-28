import { describe, expect, it } from "vitest";
import { selectTextViewerState, type TextViewerInputs } from "./text-viewer-state.js";

const MAX_DISPLAY_BYTES = 30 * 1024 * 1024;

function inputs(overrides: Partial<TextViewerInputs> = {}): TextViewerInputs {
  return {
    maxDisplayBytes: MAX_DISPLAY_BYTES,
    inline: {
      isLoading: false,
      isError: false,
      tooLarge: null,
      errorMessage: null,
      content: null,
    },
    streamed: { isLoading: false, isError: false, errorMessage: null, content: null },
    download: { requested: false, isLoading: false, objectUrl: null, fileName: null },
    ...overrides,
  };
}

describe("selectTextViewerState", () => {
  it("is 'loading' while the inline read is in flight", () => {
    const state = selectTextViewerState(
      inputs({ inline: { ...inputs().inline, isLoading: true } }),
    );
    expect(state.kind).toBe("loading");
  });

  it("is 'inline' once the inline read resolves under the cap (tier 1)", () => {
    const state = selectTextViewerState(
      inputs({ inline: { ...inputs().inline, content: "hello" } }),
    );
    expect(state).toEqual({ kind: "inline", content: "hello" });
  });

  it("is 'error' for a generic read failure (not file_too_large)", () => {
    const state = selectTextViewerState(
      inputs({ inline: { ...inputs().inline, isError: true, errorMessage: "permission denied" } }),
    );
    expect(state).toEqual({ kind: "error", message: "permission denied" });
  });

  it("is 'streaming' for a too-large-but-displayable file while the stream fetches (tier 2)", () => {
    const state = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: 12 * 1024 * 1024 } },
        streamed: { ...inputs().streamed, isLoading: true },
      }),
    );
    expect(state).toEqual({ kind: "streaming", size: 12 * 1024 * 1024 });
  });

  it("is 'streamed' once the tier-2 fetch resolves, carrying size and content", () => {
    const state = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: 12 * 1024 * 1024 } },
        streamed: { ...inputs().streamed, content: "streamed body" },
      }),
    );
    expect(state).toEqual({ kind: "streamed", size: 12 * 1024 * 1024, content: "streamed body" });
  });

  it("is 'stream-error' if the tier-2 fetch itself fails", () => {
    const state = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: 12 * 1024 * 1024 } },
        streamed: { ...inputs().streamed, isError: true, errorMessage: "network error" },
      }),
    );
    expect(state).toEqual({
      kind: "stream-error",
      size: 12 * 1024 * 1024,
      message: "network error",
    });
  });

  it("is 'too-large' for a file above the display ceiling, regardless of tier-2 state (tier 3)", () => {
    const state = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: 48 * 1024 * 1024 } },
        streamed: { ...inputs().streamed, isLoading: true }, // must be ignored — never fetched
      }),
    );
    expect(state.kind).toBe("too-large");
    if (state.kind === "too-large") {
      expect(state.size).toBe(48 * 1024 * 1024);
      expect(state.maxDisplayBytes).toBe(MAX_DISPLAY_BYTES);
    }
  });

  it("'too-large' surfaces the download's in-flight and resolved states", () => {
    const requested = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: 48 * 1024 * 1024 } },
        download: { requested: true, isLoading: true, objectUrl: null, fileName: null },
      }),
    );
    expect(requested).toMatchObject({ kind: "too-large", downloading: true, downloadUrl: null });

    const resolved = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: 48 * 1024 * 1024 } },
        download: {
          requested: true,
          isLoading: false,
          objectUrl: "blob:xyz",
          fileName: "big.txt",
        },
      }),
    );
    expect(resolved).toMatchObject({
      kind: "too-large",
      downloading: false,
      downloadUrl: "blob:xyz",
      downloadName: "big.txt",
    });
  });

  it("a file exactly at the display ceiling is still treated as displayable, not too-large", () => {
    const state = selectTextViewerState(
      inputs({
        inline: { ...inputs().inline, tooLarge: { size: MAX_DISPLAY_BYTES } },
        streamed: { ...inputs().streamed, content: "at the line" },
      }),
    );
    expect(state.kind).toBe("streamed");
  });

  it("one byte over the display ceiling flips to too-large", () => {
    const state = selectTextViewerState(
      inputs({ inline: { ...inputs().inline, tooLarge: { size: MAX_DISPLAY_BYTES + 1 } } }),
    );
    expect(state.kind).toBe("too-large");
  });
});
