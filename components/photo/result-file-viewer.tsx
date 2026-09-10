/**
 * ResultFileViewer
 *
 * The in-app preview dialog for per-photo result files. Renders straight from
 * the stored bytes (decrypted in memory by resultFileService) — nothing is
 * written to disk for a preview. Panes by file type, each with its own
 * controls: PDF renders through pdf.js with page/zoom/rotate (see
 * result-pdf-pane.tsx), images get zoom/pan/rotate (react-zoom-pan-pinch,
 * the PhotoViewer engine), RTF/text get a readable font-size control, and
 * Office formats fall back to a "save a copy" panel. The header toggle
 * expands the dialog to fill the window.
 *
 * TIFF/HEIC decode on some webviews only (macOS WKWebView does, Windows
 * WebView2 doesn't) — the image pane attempts the render and swaps to the
 * fallback panel when the decode fails.
 */

'use client';

import { Component, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { format } from 'date-fns';
import {
  TransformComponent,
  TransformWrapper,
  useControls,
  useTransformEffect,
} from 'react-zoom-pan-pinch';
import {
  Download,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ResultFileRecord } from '@/types/result-file';
import { resolveResultFileType, resultFilePreviewKind } from '@/types/result-file';
import { resultFileService } from '@/lib/services/result-file-service';
import { rtfToPlainText } from '@/lib/utils/rtf-text';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// pdf.js is ~1 MB of payload — load it only when a PDF is actually opened.
const ResultPdfPane = dynamic(() => import('./result-pdf-pane'), {
  ssr: false,
});

const TEXT_FONT_MIN = 12;
const TEXT_FONT_MAX = 28;
const TEXT_FONT_STEP = 2;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normaliseRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function PaneSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function FallbackPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <FileText className="size-10 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Last-resort guard around the preview panes: a throw inside the pdf.js or
 *  zoom pipeline must degrade to the fallback panel, never unmount the whole
 *  app. Remounted per file (keyed by the caller), which resets it. */
class PaneErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <FallbackPanel
          title="Couldn't render this file"
          hint="The viewer hit a problem displaying this file. Save a copy below and open it with your usual app."
        />
      );
    }
    return this.props.children;
  }
}

/** Live zoom percentage, fed by react-zoom-pan-pinch's transform events. */
function ScaleReadout() {
  const [scale, setScale] = useState(1);
  useTransformEffect((state) => {
    setScale(state.state.scale);
    return undefined;
  });
  return (
    <span className="min-w-11 select-none text-center text-xs tabular-nums text-muted-foreground">
      {Math.round(scale * 100)}%
    </span>
  );
}

/** Zoom/rotate controls for the image pane, floating over the image (the
 *  PhotoViewer idiom). Must sit inside TransformWrapper to read its context
 *  via hooks (controls + live scale). */
function ImagePaneToolbar({
  onRotateLeft,
  onRotateRight,
  onReset,
}: {
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onReset: () => void;
}) {
  const controls = useControls();
  return (
    <div className="absolute left-2 top-2 z-10 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow-sm backdrop-blur">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Zoom out"
        aria-label="Zoom out"
        onClick={() => controls.zoomOut(0.5)}
      >
        <ZoomOut className="size-4" />
      </Button>
      <ScaleReadout />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Zoom in"
        aria-label="Zoom in"
        onClick={() => controls.zoomIn(0.5)}
      >
        <ZoomIn className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Reset view"
        aria-label="Reset view"
        onClick={() => {
          controls.resetTransform();
          onReset();
        }}
      >
        <RefreshCw className="size-4" />
      </Button>

      <span className="mx-1 h-4 w-px bg-border" />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Rotate left"
        aria-label="Rotate left"
        onClick={onRotateLeft}
      >
        <RotateCcw className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Rotate right"
        aria-label="Rotate right"
        onClick={onRotateRight}
      >
        <RotateCw className="size-4" />
      </Button>
    </div>
  );
}

/** ponytail: rotation is a CSS transform on the img, so react-zoom-pan-pinch
 *  computes its pan bounds from the unrotated box — dragging a 90°-rotated
 *  image can overshoot slightly. Upgrade path: re-parent rotation into the
 *  transform pipeline if it ever bothers anyone. */
function ImagePane({
  url,
  alt,
  onDecodeError,
}: {
  url: string;
  alt: string;
  onDecodeError: () => void;
}) {
  const [rotation, setRotation] = useState(0);
  return (
    <div className="relative h-full overflow-hidden bg-black/95">
      <TransformWrapper
        key={url}
        minScale={0.5}
        maxScale={8}
        limitToBounds
        centerOnInit
        doubleClick={{ mode: 'toggle', step: 0.8 }}
        wheel={{ step: 0.15 }}
        panning={{ velocityDisabled: true }}
      >
        <ImagePaneToolbar
          onRotateLeft={() => setRotation((r) => normaliseRotation(r - 90))}
          onRotateRight={() => setRotation((r) => normaliseRotation(r + 90))}
          onReset={() => setRotation(0)}
        />
        {/* The library injects width/height: fit-content on its wrapper and
            content AFTER Tailwind loads, so inline styles must force the fill —
            same cascade workaround as PhotoViewer. */}
        <TransformComponent
          wrapperClass="h-full w-full"
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentClass="flex h-full w-full items-center justify-center"
          contentStyle={{ width: '100%', height: '100%', display: 'flex' }}
        >
          <div className="relative flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- local file bytes as blob URL */}
            <img
              src={url}
              alt={alt}
              draggable={false}
              onError={onDecodeError}
              className="h-full w-full select-none object-contain"
              style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
            />
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

function TextPane({ text }: { text: string }) {
  const [fontSize, setFontSize] = useState(14);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Smaller text"
          aria-label="Smaller text"
          disabled={fontSize <= TEXT_FONT_MIN}
          onClick={() => setFontSize((s) => Math.max(TEXT_FONT_MIN, s - TEXT_FONT_STEP))}
        >
          <Minus className="size-4" />
        </Button>
        <span className="min-w-11 select-none text-center text-xs tabular-nums text-muted-foreground">
          {fontSize} px
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Larger text"
          aria-label="Larger text"
          disabled={fontSize >= TEXT_FONT_MAX}
          onClick={() => setFontSize((s) => Math.min(TEXT_FONT_MAX, s + TEXT_FONT_STEP))}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <pre
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono leading-relaxed sm:p-6"
        style={{ fontSize: `${fontSize}px` }}
      >
        {text}
      </pre>
    </div>
  );
}

export function ResultFileViewer({
  file,
  onClose,
  onSaveCopy,
  isSavingCopy,
}: {
  /** The record to preview, or null to close. */
  file: ResultFileRecord | null;
  onClose: () => void;
  onSaveCopy: (file: ResultFileRecord) => void;
  isSavingCopy: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [mimeType, setMimeType] = useState('');
  const [readFailed, setReadFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const kind = file ? resultFilePreviewKind(file.originalName) : 'none';
  const extension = file ? resolveResultFileType(file.originalName)?.extension : null;

  useEffect(() => {
    setBytes(null);
    setReadFailed(false);
    setImageFailed(false);
    if (!file || resultFilePreviewKind(file.originalName) === 'none') return;
    let cancelled = false;
    resultFileService
      .readFileBytes(file.id)
      .then(({ bytes, mimeType }) => {
        if (cancelled) return;
        setBytes(bytes);
        setMimeType(mimeType);
      })
      .catch(() => {
        if (!cancelled) setReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const textContent = useMemo(() => {
    if (!bytes || kind !== 'text') return '';
    const raw = new TextDecoder().decode(bytes);
    return extension === 'rtf' ? rtfToPlainText(raw) : raw;
  }, [bytes, extension, kind]);

  // Blob URL for image panes (bytes are already in memory; the URL just hands
  // them to the <img>). Revoked when replaced or unmounted — an unreleased
  // blob URL pins the bytes for the life of the webview.
  const objectUrl = useMemo(
    () =>
      bytes && kind === 'image'
        ? URL.createObjectURL(new Blob([bytes], { type: mimeType }))
        : null,
    [bytes, mimeType, kind],
  );
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={`flex flex-col gap-0 overflow-hidden p-0 ${
          isExpanded ? 'h-[100dvh] w-[100dvw] max-w-none rounded-none sm:rounded-none' : 'h-[90dvh] max-w-4xl'
        }`}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="truncate pr-8 text-base" title={file?.originalName}>
            {file?.originalName}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="sr-only">
          Preview of an attached result file
        </DialogDescription>

        <div className="relative min-h-0 flex-1">
          <PaneErrorBoundary key={file?.id ?? 'none'}>
            {readFailed ? (
              <FallbackPanel
                title="Couldn't read this file"
                hint="The stored file could not be read from disk. Try again, or restore it from a backup."
              />
            ) : kind === 'none' ? (
              <FallbackPanel
                title="No in-app preview for this file type"
                hint="PDFs, images, RTF and text files preview here. For Office documents, save a copy and open it with your usual app."
              />
            ) : imageFailed ? (
              <FallbackPanel
                title="This image couldn't be displayed"
                hint="TIFF and HEIC files only decode on some devices. Save a copy and open it with your usual app."
              />
            ) : kind === 'pdf' ? (
              bytes ? (
                <ResultPdfPane bytes={bytes} />
              ) : (
                <PaneSpinner />
              )
            ) : kind === 'image' ? (
              objectUrl && file ? (
                <ImagePane
                  url={objectUrl}
                  alt={`Preview of ${file.originalName}`}
                  onDecodeError={() => setImageFailed(true)}
                />
              ) : (
                <PaneSpinner />
              )
            ) : bytes ? (
              <TextPane text={textContent} />
            ) : (
              <PaneSpinner />
            )}
          </PaneErrorBoundary>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 sm:px-6">
          <p className="truncate text-xs text-muted-foreground">
            {file &&
              `${formatBytes(file.fileSizeBytes)} · attached ${format(file.createdAt, 'd MMM yyyy')}`}
          </p>
          {file && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={isExpanded ? 'Exit full window' : 'Fill window'}
                aria-label={isExpanded ? 'Exit full window' : 'Fill window'}
                onClick={() => setIsExpanded((v) => !v)}
              >
                {isExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSavingCopy}
                onClick={() => onSaveCopy(file)}
              >
                {isSavingCopy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Save a copy…
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
