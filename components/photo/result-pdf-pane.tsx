/**
 * ResultPdfPane
 *
 * In-app PDF surface for the result-file viewer: react-pdf (pdf.js) renders
 * pages to canvas, so every zoom step is a crisp re-render rather than a
 * blurry CSS scale, and rotation is applied by pdf.js itself. One page at a
 * time with prev/next navigation — clinical reports are a handful of pages,
 * and single-page rendering keeps zoom cheap. Dynamically imported by the
 * viewer (pdf.js is ~1 MB of app payload we don't want on the main bundle).
 *
 * The worker and standard fonts are served from /pdfjs/ (synced from the
 * installed pdfjs-dist by scripts/sync-pdfjs-assets.mjs) so they load from
 * the app's own origin under the packaged CSP.
 *
 * ponytail: no text layer / search / continuous scroll; cMaps aren't shipped,
 * so PDFs with non-embedded CJK encodings may render with missing glyphs —
 * copy pdfjs-dist/cmaps and set cMapUrl if those ever show up.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
  MoveHorizontal,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// react-pdf v10 stopped forwarding options.workerSrc into pdf.js — its own
// default is a useless relative path, so the global must be set here. The
// worker is the same-origin asset synced from pdfjs-dist by
// scripts/sync-pdfjs-assets.mjs (kept CSP-safe: 'self', never a CDN).
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

const WORKER_OPTIONS = {
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  // The packaged CSP has no 'unsafe-eval'; without this pdf.js tries to eval
  // PostScript font functions and logs CSP violations (fonts still render,
  // via the slower path).
  isEvalSupported: false,
} as const;

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.25;
/** Padding kept either side of the page when fitting to the pane width. */
const FIT_PADDING_PX = 32;

/** Render at most 2 device pixels per CSS pixel. WebKit kills the webview's
 *  content process when a canvas allocation spikes, and a zoomed page at 3×
 *  retina is exactly where it spikes — clamping here keeps the buffer sane
 *  at a sharpness no clinical read needs to exceed. */
const MAX_DEVICE_PIXEL_RATIO = 2;
/** Canvas pixel budget per rendered page: 6000 px max side, 16 MP max area
 *  (~64 MB RGBA). Zoom stops getting sharper past the budget instead of
 *  taking the app down. */
const MAX_CANVAS_SIDE_PX = 6000;
const MAX_CANVAS_AREA_PX = 16_000_000;

function clampScale(scale: number, pixelCap: number): number {
  return Math.min(MAX_SCALE, pixelCap, Math.max(MIN_SCALE, scale));
}

function normalise(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

interface ResultPdfPaneProps {
  /** Decrypted PDF bytes, read fresh from storage for this preview. */
  bytes: Uint8Array<ArrayBuffer>;
}

export default function ResultPdfPane({ bytes }: ResultPdfPaneProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loadError, setLoadError] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Fit-to-width runs once per document, off the first page's viewport —
  // afterwards the zoom belongs to the clinician.
  const fittedRef = useRef(false);
  // Page size at scale 1 (intrinsic orientation), for fit-to-width and the
  // canvas pixel budget.
  const [basePageSize, setBasePageSize] = useState({ width: 0, height: 0 });
  // Device pixels per CSS pixel, capped (see MAX_DEVICE_PIXEL_RATIO).
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  // Scale ceiling implied by the canvas budget; refined once the page loads.
  const [pixelCapScale, setPixelCapScale] = useState(MAX_SCALE);

  // The pane resizes with the dialog (fullscreen toggle, window resize), so
  // track the live width; the fit only consumes the first reading.
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setPaneWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // react-pdf reloads the document whenever the `file` prop identity changes,
  // so the bytes are wrapped exactly once per preview. pdf.js takes ownership
  // of (transfers) the buffer it is handed, so it gets a private copy — a
  // reload of the same preview must not trip over a detached ArrayBuffer.
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);

  function handleDocumentLoad(pdf: PDFDocumentProxy) {
    setNumPages(pdf.numPages);
  }

  function handlePageLoad(page: PDFPageProxy) {
    const viewport = page.getViewport({ scale: 1 });
    setBasePageSize({ width: viewport.width, height: viewport.height });
    if (!fittedRef.current && viewport.width > 0 && paneWidth > 0) {
      fittedRef.current = true;
      setScale(clampScale((paneWidth - FIT_PADDING_PX) / viewport.width, MAX_SCALE));
    }
  }

  // Translate the canvas budget into a scale ceiling. The maths are symmetric
  // in width/height, so rotation never needs to recompute it.
  useEffect(() => {
    const { width, height } = basePageSize;
    if (width <= 0 || height <= 0) return;
    const sideCap = MAX_CANVAS_SIDE_PX / (Math.max(width, height) * dpr);
    const areaCap = Math.sqrt(MAX_CANVAS_AREA_PX / (width * height * dpr * dpr));
    setPixelCapScale(Math.max(MIN_SCALE, Math.min(sideCap, areaCap)));
  }, [basePageSize, dpr]);

  // A cap that lands below the current zoom (first page load, rotation of a
  // differently-sized page) pulls the scale back in.
  useEffect(() => {
    setScale((current) => Math.min(current, pixelCapScale));
  }, [pixelCapScale]);

  function goToPage(next: number) {
    if (numPages === null) return;
    setPageNumber(Math.min(numPages, Math.max(1, next)));
    scrollRef.current?.scrollTo(0, 0);
  }

  function zoomBy(factor: number) {
    setScale((current) => clampScale(current * factor, pixelCapScale));
  }

  function fitWidth() {
    if (basePageSize.width > 0 && paneWidth > 0) {
      setScale(
        clampScale((paneWidth - FIT_PADDING_PX) / basePageSize.width, pixelCapScale),
      );
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Couldn&apos;t render this PDF</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The file may be corrupt or password-protected. Save a copy below and
          open it with your usual PDF app.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Previous page"
          aria-label="Previous page"
          disabled={pageNumber <= 1}
          onClick={() => goToPage(pageNumber - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-14 select-none text-center text-xs tabular-nums text-muted-foreground">
          {numPages === null ? '…' : `${pageNumber} / ${numPages}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Next page"
          aria-label="Next page"
          disabled={numPages === null || pageNumber >= numPages}
          onClick={() => goToPage(pageNumber + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>

        <span className="mx-1 h-4 w-px bg-border" />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOut className="size-4" />
        </Button>
        <span className="min-w-11 select-none text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Fit to width"
          aria-label="Fit to width"
          onClick={fitWidth}
        >
          <MoveHorizontal className="size-4" />
        </Button>

        <span className="mx-1 h-4 w-px bg-border" />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Rotate left"
          aria-label="Rotate left"
          onClick={() => setRotation((r) => normalise(r - 90))}
        >
          <RotateCcw className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Rotate right"
          aria-label="Rotate right"
          onClick={() => setRotation((r) => normalise(r + 90))}
        >
          <RotateCw className="size-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-black/95 p-4">
        <div className="flex justify-center">
          <Document
            file={file}
            options={WORKER_OPTIONS}
            onLoadSuccess={handleDocumentLoad}
            onError={() => setLoadError(true)}
            loading={
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            }
            className="inline-block"
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              rotate={rotation}
              devicePixelRatio={dpr}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={handlePageLoad}
              loading={<Loader2 className="size-6 animate-spin text-muted-foreground" />}
              error={
                <p className="max-w-xs p-4 text-center text-xs text-muted-foreground">
                  This page couldn&apos;t be rendered.
                </p>
              }
              className="mx-auto"
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
