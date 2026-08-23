'use client';

/**
 * PhotoCompareDialog
 *
 * Two photos of a patient, side by side or stacked as an opacity overlay —
 * the wound-progression / before-after workflow. Zoom and pan are one shared
 * state applied to both panes, so dragging or scrolling either image moves
 * them in lockstep regardless of differing natural sizes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Columns2, Layers, Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { BodyPartLabels } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Mode = 'side' | 'overlay';

interface PhotoCompareDialogProps {
  photos: PhotoRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function photoLabel(photo: PhotoRecord): string {
  const part = BodyPartLabels[photo.bodyPart] ?? photo.bodyPart;
  return `${format(photo.capturedAt, 'd MMM yyyy')} · ${part}${photo.subpart ? ` · ${photo.subpart}` : ''}`;
}

export function PhotoCompareDialog({ photos, open, onOpenChange }: PhotoCompareDialogProps) {
  // Newest first; default to the two most recent captures.
  const sorted = useMemo(
    () => [...photos].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()),
    [photos],
  );

  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('side');
  const [opacity, setOpacity] = useState(50);

  const [leftUrl, setLeftUrl] = useState<string | null>(null);
  const [rightUrl, setRightUrl] = useState<string | null>(null);

  // Shared viewport state for both panes.
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Seed picks whenever the dialog (re)opens with fresh photos.
  useEffect(() => {
    if (!open) return;
    setLeftId(sorted[0]?.id ?? null);
    setRightId(sorted[1]?.id ?? null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [open, sorted]);

  // Load full-size images for the current picks.
  useEffect(() => {
    let cancelled = false;
    async function load(id: string | null, set: (u: string | null) => void) {
      if (!id) {
        set(null);
        return;
      }
      set(null);
      try {
        const url = await photoService.exportPhotoAsDataUrl(id);
        if (!cancelled) set(url);
      } catch {
        if (!cancelled) set(null);
      }
    }
    void load(leftId, setLeftUrl);
    void load(rightId, setRightUrl);
    return () => {
      cancelled = true;
    };
  }, [leftId, rightId]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    },
    [offset],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.ox + (e.clientX - drag.x), y: drag.oy + (e.clientY - drag.y) });
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 0.87))));
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const left = sorted.find((p) => p.id === leftId) ?? null;
  const right = sorted.find((p) => p.id === rightId) ?? null;

  const transform = { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` };

  const pane = (photo: PhotoRecord | null, url: string | null, className?: string) => (
    <div
      className={cn('relative flex items-center justify-center overflow-hidden bg-black', className)}
      style={{ cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {url ? (
        <img
          src={url}
          alt={photo ? `Photo from ${format(photo.capturedAt, 'd MMM yyyy')}` : 'Photo'}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain transition-transform duration-75"
          style={transform}
        />
      ) : (
        <Loader2 className="size-8 animate-spin text-white/50" aria-label="Loading photo" />
      )}
      {photo && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
          {format(photo.capturedAt, 'd MMM yyyy, HH:mm')}
        </span>
      )}
    </div>
  );

  /** Overlay mode: both photos stacked, the later one's opacity is dialled. */
  const overlayPane = (
    <div
      className="relative flex h-full items-center justify-center overflow-hidden rounded-lg border bg-black"
      style={{ cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {[leftUrl, rightUrl].map(
        (url, i) =>
          url && (
            <img
              key={i}
              src={url}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute max-h-full max-w-full select-none object-contain transition-transform duration-75"
              style={{ ...transform, opacity: i === 0 ? 1 : opacity / 100 }}
            />
          ),
      )}
      {!leftUrl && !rightUrl && <Loader2 className="size-8 animate-spin text-white/50" aria-label="Loading photos" />}
      <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {left && right
          ? `${format(left.capturedAt, 'd MMM yy')} → ${format(right.capturedAt, 'd MMM yy')} (${opacity}%)`
          : null}
      </span>
    </div>
  );

  const picker = (
    which: 'left' | 'right',
    id: string | null,
    setId: (id: string) => void,
  ) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">
        {which === 'left' ? 'Earlier / reference' : 'Later / current'}
      </Label>
      <Select value={id ?? undefined} onValueChange={setId}>
        <SelectTrigger aria-label={`Photo to compare, ${which}`}>
          <SelectValue placeholder="Choose a photo" />
        </SelectTrigger>
        <SelectContent>
          {sorted.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {photoLabel(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-w-6xl flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compare photos</DialogTitle>
          <DialogDescription>
            Zoom and pan are shared — both photos move together.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          {picker('left', leftId, setLeftId)}
          {picker('right', rightId, setRightId)}
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <div className="flex rounded-lg border p-1" role="group" aria-label="Compare mode">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={mode === 'side'}
                className={cn('gap-1.5', mode === 'side' && 'bg-accent')}
                onClick={() => setMode('side')}
              >
                <Columns2 className="size-4" /> Side by side
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={mode === 'overlay'}
                className={cn('gap-1.5', mode === 'overlay' && 'bg-accent')}
                onClick={() => setMode('overlay')}
              >
                <Layers className="size-4" /> Overlay
              </Button>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.25))}>
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-12 text-center text-sm tabular-nums" aria-label="Zoom level">
              {Math.round(zoom * 100)}%
            </span>
            <Button type="button" variant="outline" size="icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>
              <ZoomIn className="size-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label="Reset zoom and pan" onClick={reset}>
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </div>

        {mode === 'overlay' && (
          <div className="flex items-center gap-3">
            <Label htmlFor="overlay-opacity" className="whitespace-nowrap text-xs text-muted-foreground">
              Overlay opacity
            </Label>
            <input
              id="overlay-opacity"
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full accent-primary"
              aria-valuetext={`${opacity}%`}
            />
          </div>
        )}

        <div className="min-h-0 flex-1">
          {sorted.length < 2 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              This patient needs at least two photos to compare.
            </div>
          ) : mode === 'side' ? (
            <div className="grid h-full grid-cols-2 gap-2 rounded-lg border">
              {pane(left, leftUrl)}
              {pane(right, rightUrl)}
            </div>
          ) : (
            overlayPane
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
