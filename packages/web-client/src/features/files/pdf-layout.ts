/**
 * Pure layout maths for `PdfViewer` (zoom ladder, fit-width, canvas resolution, page positions).
 * Framework-free so the boundaries are unit-testable without a DOM or pdf.js.
 */

/** Zoom ladder the +/- buttons walk, as scale factors (1 = 100%, a PDF point = 1 CSS px). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export const MIN_SCALE = ZOOM_STEPS[0]!;
export const MAX_SCALE = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** Hard cap on one page canvas's backing store (4096 × 4096). Past it the page renders softer
 *  rather than allocating without bound at high zoom on a large page. */
export const MAX_CANVAS_PIXELS = 16_777_216;

// A scale a hair below a rung (a fit-width result of 0.9999) must still step to the next rung.
const EPSILON = 1e-6;

/** The first rung above `scale`, or the top rung. */
export function nextZoom(scale: number): number {
  return ZOOM_STEPS.find((step) => step > scale + EPSILON) ?? MAX_SCALE;
}

/** The last rung below `scale`, or the bottom rung. */
export function prevZoom(scale: number): number {
  return ZOOM_STEPS.findLast((step) => step < scale - EPSILON) ?? MIN_SCALE;
}

/** Scale at which the widest page exactly fills `containerWidth - padding`, clamped to the ladder
 *  range. A degenerate container or page (zero/negative width) yields 1, never NaN/Infinity. */
export function fitWidthScale(
  containerWidth: number,
  padding: number,
  widestPageWidth: number,
): number {
  const available = containerWidth - padding;
  if (available <= 0 || widestPageWidth <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / widestPageWidth));
}

/** Backing-store pixels per CSS pixel: `dpr`, reduced just enough to keep the page's canvas
 *  within `maxPixels`. */
export function canvasPixelRatio(
  pageWidth: number,
  pageHeight: number,
  scale: number,
  dpr: number,
  maxPixels: number = MAX_CANVAS_PIXELS,
): number {
  const cssArea = pageWidth * scale * (pageHeight * scale);
  if (cssArea <= 0) return dpr;
  return Math.min(dpr, Math.sqrt(maxPixels / cssArea));
}

/** Top offset of each page block in the scroll content, for pages stacked with `gap` between them
 *  and `padding` above the first. Page heights are at scale 1. */
export function pageTops(
  pageHeights: readonly number[],
  scale: number,
  gap: number,
  padding: number,
): number[] {
  const tops: number[] = [];
  let top = padding;
  for (const height of pageHeights) {
    tops.push(top);
    top += height * scale + gap;
  }
  return tops;
}

/** 0-based index of the page occupying the vertical midpoint of the viewport: the last page that
 *  starts at or above it. 0 for an empty document. */
export function pageAtMidpoint(
  tops: readonly number[],
  scrollTop: number,
  viewportHeight: number,
): number {
  const midpoint = scrollTop + viewportHeight / 2;
  const after = tops.findIndex((top) => top > midpoint);
  return Math.max(0, (after === -1 ? tops.length : after) - 1);
}
