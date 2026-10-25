/**
 * PdfViewer — renders a PDF in place with pdf.js's core API (swe/features/pdf-file-preview.md).
 *
 * Pages are a stack of pre-sized blocks; a block holds a canvas + selectable text layer only while
 * it is near the viewport, so memory is bounded by the window, not the page count. A re-download
 * (live refresh) loads the new document beside the old one and swaps them in one commit, so the
 * scroll container never remounts and `scrollTop` survives.
 *
 * Deliberately no annotation/form/XFA/scripting layers: a PDF is untrusted input, and nothing in
 * it may run code or open a URL.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import { PDFJS_ASSET_URLS, loadPdfjs } from "./pdfjs-runtime.js";
import {
  canvasPixelRatio,
  fitWidthScale,
  nextZoom,
  pageAtMidpoint,
  pageTops,
  prevZoom,
} from "./pdf-layout.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./PdfViewer.module.css";

/** Vertical gap between page blocks and padding around the stack, in CSS px (matches the CSS). */
const PAGE_GAP = 12;
const STACK_PADDING = 16;
/** A page counts as near-visible within one viewport height above/below the scroll container. */
const NEAR_MARGIN = "100% 0px";
/** Container resizes settle this long before Fit width re-renders every visible page. */
const RESIZE_DEBOUNCE_MS = 120;

interface PageSize {
  width: number;
  height: number;
}

interface LoadedDocument {
  /** Owns the document: destroying the task releases the worker-side document too. */
  task: PDFDocumentLoadingTask;
  doc: PDFDocumentProxy;
  sizes: PageSize[];
}

type LoadFailure = "invalid" | "password" | "failed";

const FAILURE_MESSAGE: Record<LoadFailure, string> = {
  invalid: "This file could not be opened as a PDF.",
  password: "This PDF is password-protected.",
  failed: "This PDF could not be loaded.",
};

function classifyFailure(err: unknown): LoadFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "PasswordException") return "password";
  if (name === "InvalidPDFException" || name === "FormatError" || name === "MissingPDFException") {
    return "invalid";
  }
  return "failed";
}

/** pdf.js reports a cancelled render/layer as an exception; that is control flow, not a failure. */
function isCancellation(err: unknown): boolean {
  return err instanceof Error && /Cancelled|destroyed/i.test(`${err.name} ${err.message}`);
}

export function PdfViewer({ path }: ViewerProps) {
  const query = useFileDownload(path);
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [fitWidth, setFitWidth] = useState(true);
  const [manualScale, setManualScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);

  const objectUrl = query.data?.objectUrl;

  // Load (or reload) the document. The new one is committed only when fully parsed and measured;
  // until then the previous document stays on screen.
  useEffect(() => {
    if (!objectUrl) return;
    let cancelled = false;
    let committed = false;
    let task: PDFDocumentLoadingTask | null = null;
    void (async () => {
      try {
        // Bytes, not the URL: pdf.js would otherwise keep fetching from an object URL that
        // `useFileDownload` revokes the moment a refresh supersedes it.
        const bytes = new Uint8Array(await (await fetch(objectUrl)).arrayBuffer());
        if (cancelled) return;
        task = loadPdfjs().getDocument({ data: bytes, enableXfa: false, ...PDFJS_ASSET_URLS });
        const doc = await task.promise;
        const sizes = await Promise.all(
          Array.from({ length: doc.numPages }, async (_, i) => {
            const { width, height } = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
            return { width, height };
          }),
        );
        if (cancelled) return;
        committed = true;
        setFailure(null);
        setLoaded({ task, doc, sizes });
      } catch (err) {
        if (!cancelled) setFailure(classifyFailure(err));
      }
    })();
    return () => {
      cancelled = true;
      // Abandon a load that never committed. A committed document is destroyed by the effect
      // below, only once a replacement (or unmount) actually displaces it.
      if (!committed) void task?.destroy();
    };
  }, [objectUrl]);

  useEffect(() => {
    const task = loaded?.task;
    return () => void task?.destroy();
  }, [loaded?.task]);

  // Track the scroll container's width, settling before a resize drives re-renders.
  useEffect(() => {
    if (!scroller) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      clearTimeout(timer);
      if (first) {
        first = false;
        setContainerWidth(width);
        return;
      }
      timer = setTimeout(() => setContainerWidth(width), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(scroller);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [scroller]);

  const sizes = loaded?.sizes;
  const widest = useMemo(() => Math.max(0, ...(sizes ?? []).map((s) => s.width)), [sizes]);
  const scale = fitWidth ? fitWidthScale(containerWidth, STACK_PADDING * 2, widest) : manualScale;
  const tops = useMemo(
    () =>
      pageTops(
        (sizes ?? []).map((s) => s.height),
        scale,
        PAGE_GAP,
        STACK_PADDING,
      ),
    [sizes, scale],
  );

  const updateCurrentPage = () => {
    if (!scroller) return;
    setCurrentPage(pageAtMidpoint(tops, scroller.scrollTop, scroller.clientHeight));
  };

  // Keep the reader at the same relative position when the scale changes.
  const previousScale = useRef(scale);
  useLayoutEffect(() => {
    if (scroller && previousScale.current !== scale) {
      scroller.scrollTop = (scroller.scrollTop * scale) / previousScale.current;
    }
    previousScale.current = scale;
  }, [scale, scroller]);

  // Page numbering follows content too (a reload can change the page count).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed whenever `tops` changes
  useEffect(updateCurrentPage, [tops, scroller]);

  const download = () => {
    if (!objectUrl) return;
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = query.data?.fileName || path.split("/").pop() || "document.pdf";
    link.click();
  };

  if (query.isError) {
    return (
      <EmptyState>
        Error: {query.error instanceof Error ? query.error.message : "unknown error"}
      </EmptyState>
    );
  }
  if (failure && !loaded) {
    return (
      <div className={styles.failure}>
        <span>{FAILURE_MESSAGE[failure]}</span>
        <Button size="sm" onClick={download}>
          Download
        </Button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading PDF...
      </EmptyState>
    );
  }
  if (loaded.sizes.length === 0) {
    return (
      <div className={styles.failure}>
        <span>This PDF has no pages.</span>
        <Button size="sm" onClick={download}>
          Download
        </Button>
      </div>
    );
  }

  const zoomFrom = (next: (s: number) => number) => {
    setManualScale(next(scale));
    setFitWidth(false);
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <span className={styles.pageIndicator} aria-live="polite">
          {currentPage + 1} / {loaded.sizes.length}
        </span>
        <div className={styles.controls}>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label="Zoom out"
            onClick={() => zoomFrom(prevZoom)}
          >
            <ZoomOut size={14} />
          </Button>
          <span className={styles.zoom}>{Math.round(scale * 100)}%</span>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label="Zoom in"
            onClick={() => zoomFrom(nextZoom)}
          >
            <ZoomIn size={14} />
          </Button>
          <Button
            size="xs"
            variant={fitWidth ? "default" : "ghost"}
            iconOnly
            aria-label="Fit width"
            aria-pressed={fitWidth}
            onClick={() => setFitWidth((on) => !on)}
          >
            <MoveHorizontal size={14} />
          </Button>
          <Button size="xs" variant="ghost" iconOnly aria-label="Download PDF" onClick={download}>
            <Download size={14} />
          </Button>
        </div>
      </div>
      <div ref={setScroller} className={styles.scroller} onScroll={updateCurrentPage}>
        <div className={styles.stack}>
          {loaded.sizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={loaded.doc}
              pageNumber={i + 1}
              size={size}
              scale={scale}
              root={scroller}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  scale: number;
  /** The scroll container, observed for proximity. `null` until it mounts. */
  root: HTMLElement | null;
}

function PdfPage({ doc, pageNumber, size, scale, root }: PdfPageProps) {
  const blockRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const block = blockRef.current;
    if (!root || !block) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? false),
      {
        root,
        rootMargin: NEAR_MARGIN,
      },
    );
    observer.observe(block);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    if (!near) {
      // Far from the viewport: release the canvas and text layer (their backing stores are the
      // memory cost); the pre-sized block keeps the scroll height.
      block.replaceChildren();
      return;
    }
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let textLayer: { cancel(): void } | null = null;
    void (async () => {
      try {
        const pdfjs = loadPdfjs();
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const ratio = canvasPixelRatio(
          size.width,
          size.height,
          scale,
          window.devicePixelRatio || 1,
        );

        // Render off-screen and swap in whole, so a zoom or reload never flashes a blank page.
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.className = styles.canvas ?? "";
        const task = page.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        renderTask = task;
        await task.promise;

        const text = document.createElement("div");
        text.className = `textLayer ${styles.textLayer ?? ""}`;
        text.style.setProperty("--total-scale-factor", String(scale));
        const layer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: text,
          viewport,
        });
        textLayer = layer;
        await layer.render();

        if (cancelled) return;
        block.replaceChildren(canvas, text);
        setError(null);
      } catch (err) {
        if (!cancelled && !isCancellation(err)) {
          setError(err instanceof Error ? err.message : "render failed");
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [near, doc, pageNumber, scale, size.width, size.height]);

  return (
    <div
      ref={blockRef}
      className={styles.page}
      style={{ width: size.width * scale, height: size.height * scale }}
      data-page={pageNumber}
    >
      {error && <span className={styles.pageError}>Page {pageNumber} failed to render.</span>}
    </div>
  );
}
