/**
 * Terminal webfont readiness (`theme/fonts.css`, `theme/tokens.ts`'s `TERMINAL_FONT_STACK`).
 *
 * xterm.js measures one character to derive its cell size, once, inside `terminal.open()`, and the
 * DOM renderer positions every row against that number. Measuring before the bundled face has
 * loaded therefore measures a *fallback* font and pins the grid to the wrong width for the life of
 * the emulator — visibly a shell that wraps early and paints backgrounds short of the last column.
 * Re-measuring afterwards is not available to an embedder: `CharSizeService.measure()` is internal,
 * and xterm's options setter drops an assignment equal to the current value
 * (`OptionsService._setupOptions`), so the usual "re-assign `options.fontFamily` to force a
 * re-measure" trick is a no-op for the font we already set. Waiting is the honest fix.
 *
 * The wait is one shared promise, resolved at most once per page: N terminal tabs must not each
 * issue their own `FontFaceSet.load`, and a tab opened later must not wait again for a face that
 * is already in memory — `isTerminalFontReady()` is the synchronous fast path for exactly that,
 * and is true for every terminal after the first.
 *
 * Only the TEXT face is awaited. The icon face is deliberately not: it is range-restricted to the
 * private-use planes (`theme/fonts.css`), so probing it here would pull 976 KB into a session that
 * may never paint a single icon — and it cannot affect the measurement anyway, since both files
 * share one advance width by construction.
 */

import { baseFontSize, TERMINAL_FONT_STACK } from "@pi-studio-ui/theme/tokens.js";

/** A cap, not a schedule: a face that has not arrived in 3s is treated as absent and the terminal
 *  mounts against whatever the browser can render, rather than leaving the panel blank forever on
 *  a flaky network or a proxy that mangles `font/woff2`. */
const FONT_LOAD_TIMEOUT_MS = 3000;

/** CSS font shorthand for `FontFaceSet`. The size is immaterial to which faces match — only the
 *  family list is — but the shorthand is invalid without one, and `sm` is the rung the panel
 *  actually renders at. */
const FONT_SHORTHAND = `${baseFontSize.sm}px ${TERMINAL_FONT_STACK}`;

/** Probe character: latin, so it matches the text face and never the icon-only one. */
const PROBE_TEXT = "M";

/**
 * Whether the terminal's text face can be painted right now, so the caller may measure a cell
 * synchronously. `FontFaceSet.check` reports on the document's own `@font-face` rules only, and
 * answers `true` when none of them match — which is the correct answer for a browser that will
 * render the stack from an installed font.
 *
 * `document.fonts` is absent in a non-DOM environment and in a few embedded webviews; both mean
 * "nothing to wait for", never "wait forever". A throw is only reachable if the shorthand fails to
 * parse, which would be a bug in the stack constant rather than a runtime condition — mounting
 * against a fallback still beats hanging.
 */
export function isTerminalFontReady(): boolean {
  if (typeof document === "undefined" || !document.fonts) return true;
  try {
    return document.fonts.check(FONT_SHORTHAND, PROBE_TEXT);
  } catch {
    return true;
  }
}

/**
 * Resolves when the terminal's text face is painted-ready, or when waiting stops being worth it.
 * Never rejects — a font failure must not take a terminal tab down with it.
 *
 * Started at module import (i.e. when the first terminal panel is code-loaded) rather than lazily
 * per mount, so the fetch overlaps the `create_terminal_request` round-trip instead of following
 * it.
 */
export const terminalFontReady: Promise<void> = (async () => {
  if (typeof document === "undefined" || !document.fonts || isTerminalFontReady()) return;
  let timer: number | undefined;
  try {
    await Promise.race([
      document.fonts.load(FONT_SHORTHAND, PROBE_TEXT),
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Swallowed by design — see the doc comment.
  } finally {
    window.clearTimeout(timer);
  }
})();
