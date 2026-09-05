'use client';

/**
 * PhotoCompareView
 *
 * The two-pane comparison viewer shared by the patient's before/after
 * dialog and the cross-patient Compare page. Each side picks from its own
 * pool (usually one patient's photos). An anchor toggle controls the
 * viewport link: anchored (the default) a drag or scroll on either photo
 * moves both together; unanchored each pane pans and zooms freely — and
 * re-anchoring makes the next gesture move them together from wherever
 * they were left, so independently framed lesions stay framed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Columns2,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { bodyPartDisplayLabel } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import {
  applyPan,
  applyZoom,
  COMPARE_ZOOM_STEP,
  defaultComparePicks,
  DEFAULT_COMPARE_TRANSFORM,
  type CompareSide,
  type CompareTransform,
  type CompareTransforms,
} from '@/lib/photo-compare';
import { Button } from '@/components/ui/button';
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

interface PhotoCompareViewProps {
  /** Newest-first photo pool for the left pane. */
  leftPool: PhotoRecord[];
  /** Newest-first photo pool for the right pane. */
  rightPool: PhotoRecord[];
  /** Picker labels — name the patient (Compare page) or the role (dialog). */
  leftLabel: string;
  rightLabel: string;
  /** Sizing hook for the host page; defaults to filling a flex column. */
  className?: string;
}

function photoLabel(photo: PhotoRecord): string {
  const part = bodyPartDisplayLabel(photo.bodyPart, photo.laterality);
  return `${format(photo.capturedAt, 'd MMM yyyy')} · ${part}${photo.subpart ? ` · ${photo.subpart}` : ''}`;
}

export function PhotoCompareView({
  leftPool,
  rightPool,
  leftLabel,
  rightLabel,
  className,
}: PhotoCompareViewProps) {
  const leftSorted = useMemo(
    () => [...leftPool].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()),
    [leftPool],
  );
  const rightSorted = useMemo(
    () => [...rightPool].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()),
    [rightPool],
  );

  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('side');
  const [opacity, setOpacity] = useState(50);

  // Viewport link: anchored panes move together, free panes move alone.
  const [anchored, setAnchored] = useState(true);
  // Anchor also lives in a ref so gesture callbacks stay referentially
  // stable while always applying the toggle's current value.
  const anchoredRef = useRef(anchored);
  useEffect(() => {
    anchoredRef.current = anchored;
  }, [anchored]);
  // Per-pane viewport state; the last-touched pane drives the zoom buttons
  // while unanchored.
  const [transforms, setTransforms] = useState<CompareTransforms>({
    left: DEFAULT_COMPARE_TRANSFORM,
    right: DEFAULT_COMPARE_TRANSFORM,
  });
  const [activeSide, setActiveSide] = useState<CompareSide>('left');
  // Drag in React state (not just a ref): the panes drop the transform
  // transition mid-drag — a running transition re-fights every frame and
  // reads as lag — and only a re-render can swap the grabbing cursor.
  const [dragging, setDragging] = useState(false);

  const [leftUrl, setLeftUrl] = useState<string | null>(null);
  const [rightUrl, setRightUrl] = useState<string | null>(null);

  // Pan gesture: the pointer start plus a snapshot of both panes' transforms
  // at gesture start (deltas are relative to the pointer-down, and anchored
  // panning must move each pane from where it individually was).
  const dragRef = useRef<{
    x: number;
    y: number;
    start: CompareTransforms;
    side: CompareSide;
  } | null>(null);
  // Pointer moves arrive faster than frames; only the latest is applied,
  // once per frame. Pan deltas are relative to the gesture start, so
  // collapsing the intermediate positions is safe.
  const moveFrameRef = useRef<number | null>(null);
  const moveRef = useRef<{ x: number; y: number } | null>(null);

  // Seed (and re-seed when the pools genuinely change — different patients
  // or filter). Keying on the pool ids rather than array identity keeps a
  // background refresh from clobbering the user's picks. Memoised: the key
  // joins every pool id, and gestures re-render this component per frame.
  const poolKey = useMemo(
    () =>
      `${leftSorted.map((p) => p.id).join(',')}|${rightSorted.map((p) => p.id).join(',')}`,
    [leftSorted, rightSorted],
  );
  useEffect(() => {
    const picks = defaultComparePicks(leftSorted, rightSorted);
    setLeftId(picks.leftId);
    setRightId(picks.rightId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poolKey covers pool identity; array deps would reseed on every refresh
  }, [poolKey]);

  // A new photo (chosen from a picker or seeded by a pool change) resets the
  // viewport: default zoom, centred, anchor semantics back to plain.
  useEffect(() => {
    setTransforms({ left: DEFAULT_COMPARE_TRANSFORM, right: DEFAULT_COMPARE_TRANSFORM });
    setActiveSide('left');
  }, [leftId, rightId]);

  // Load images for the current picks: a new pick clears the pane, a
  // thumbnail (small — decodes in a frame or two) shows it, and the
  // full-size render swaps in behind it. Both requests start together so
  // the sharp image isn't queued behind the thumbnail round-trip.
  // A side whose pick hasn't changed is skipped — picking one pane's photo
  // re-runs this effect for both, and the other side's bytes are already on
  // screen. Only a finished load marks the side, so cancelled ones re-run.
  const loadedRef = useRef<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });
  useEffect(() => {
    let cancelled = false;
    async function load(
      id: string | null,
      side: 'left' | 'right',
      set: (u: string | null) => void,
    ) {
      if (!id) {
        loadedRef.current[side] = null;
        set(null);
        return;
      }
      if (loadedRef.current[side] === id) return;
      set(null);
      const thumb = photoService.exportPhotoAsDataUrl(id, true).catch(() => null);
      const full = photoService
        .exportPhotoAsDataUrl(id)
        .then((url) => url, () => null);
      const thumbUrl = await thumb;
      if (cancelled) return;
      if (thumbUrl) set(thumbUrl);
      const fullUrl = await full;
      if (cancelled) return;
      // A failed full-size load keeps the thumbnail rather than blanking.
      set(fullUrl ?? thumbUrl);
      loadedRef.current[side] = id;
    }
    void load(leftId, 'left', setLeftUrl);
    void load(rightId, 'right', setRightUrl);
    return () => {
      cancelled = true;
    };
  }, [leftId, rightId]);

  const applyPendingPan = useCallback(() => {
    const drag = dragRef.current;
    const move = moveRef.current;
    moveRef.current = null;
    if (!drag || !move) return;
    setTransforms(
      applyPan(drag.start, move.x - drag.x, move.y - drag.y, anchoredRef.current, drag.side),
    );
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, side: CompareSide) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY, start: transforms, side };
      setActiveSide(side);
      setDragging(true);
    },
    [transforms],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      moveRef.current = { x: e.clientX, y: e.clientY };
      if (moveFrameRef.current == null) {
        moveFrameRef.current = requestAnimationFrame(() => {
          moveFrameRef.current = null;
          applyPendingPan();
        });
      }
    },
    [applyPendingPan],
  );

  const onPointerUp = useCallback(() => {
    // Flush a coalesced move so the image lands where the pointer stopped.
    if (moveFrameRef.current != null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    applyPendingPan();
    dragRef.current = null;
    setDragging(false);
  }, [applyPendingPan]);

  // React registers wheel listeners passively, so preventDefault inside
  // onWheel is a no-op — the view scrolls while zooming and the console
  // complains per tick. Attach native non-passive listeners per pane
  // instead; the effect re-runs when the mode swap changes which panes
  // exist.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-compare-pane]'));
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const side = ((e.currentTarget as HTMLElement).dataset.comparePane ?? 'left') as CompareSide;
      setActiveSide(side);
      setTransforms((prev) =>
        applyZoom(prev, e.deltaY < 0 ? 1.15 : 0.87, anchoredRef.current, side),
      );
    };
    for (const el of els) el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      for (const el of els) el.removeEventListener('wheel', onWheel);
    };
  }, [mode]);

  const reset = useCallback(() => {
    setTransforms({ left: DEFAULT_COMPARE_TRANSFORM, right: DEFAULT_COMPARE_TRANSFORM });
  }, []);

  const left = leftSorted.find((p) => p.id === leftId) ?? null;
  const right = rightSorted.find((p) => p.id === rightId) ?? null;

  const tfStyle = (t: CompareTransform) => ({
    transform: `translate(${t.offset.x}px, ${t.offset.y}px) scale(${t.zoom})`,
  });

  const emptyMessage = (pool: PhotoRecord[]) =>
    pool.length === 0 ? 'No photos for this selection.' : null;

  const pane = (
    side: CompareSide,
    photo: PhotoRecord | null,
    url: string | null,
    pool: PhotoRecord[],
  ) => {
    const empty = photo ? null : emptyMessage(pool);
    return (
      <div
        className="relative flex items-center justify-center overflow-hidden bg-black"
        style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        data-compare-pane={side}
        onPointerDown={(e) => onPointerDown(e, side)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {url ? (
          <img
            src={url}
            alt={photo ? `Photo from ${format(photo.capturedAt, 'd MMM yyyy')}` : 'Photo'}
            draggable={false}
            className={cn(
              'max-h-full max-w-full select-none object-contain',
              !dragging && 'transition-transform duration-75',
            )}
            style={tfStyle(transforms[side])}
          />
        ) : empty ? (
          <span className="px-4 text-center text-sm text-white/60">{empty}</span>
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
  };

  /** Overlay mode: both photos stacked, the later one's opacity is dialled.
      Each layer keeps its own pane transform, so unanchored framing survives
      the fade. */
  const overlayPane = (
    <div
      className="relative flex h-full items-center justify-center overflow-hidden rounded-lg border bg-black"
      style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      data-compare-pane="left"
      onPointerDown={(e) => onPointerDown(e, 'left')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {(
        [
          ['left', leftUrl, transforms.left],
          ['right', rightUrl, transforms.right],
        ] as const
      ).map(
        ([side, url, tf], i) =>
          url && (
            <img
              key={side}
              src={url}
              alt=""
              aria-hidden
              draggable={false}
              className={cn(
                'absolute max-h-full max-w-full select-none object-contain',
                !dragging && 'transition-transform duration-75',
              )}
              style={{ ...tfStyle(tf), opacity: i === 0 ? 1 : opacity / 100 }}
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
    label: string,
    pool: PhotoRecord[],
    id: string | null,
    setId: (id: string) => void,
  ) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={id ?? undefined} onValueChange={setId}>
        <SelectTrigger aria-label={`Photo to compare, ${which}`}>
          <SelectValue placeholder="Choose a photo" />
        </SelectTrigger>
        <SelectContent>
          {pool.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {photoLabel(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div ref={rootRef} className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-end gap-3">
        {picker('left', leftLabel, leftSorted, leftId, setLeftId)}
        {picker('right', rightLabel, rightSorted, rightId, setRightId)}
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
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Anchor</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={anchored}
            aria-label={anchored ? 'Anchor panes together' : 'Panes move freely'}
            title={
              anchored
                ? 'Panes pan and zoom together — toggle off to move each photo freely'
                : 'Panes move freely — toggle on and the next gesture moves them together from here'
            }
            className={cn('gap-1.5', anchored && 'bg-accent')}
            onClick={() => setAnchored((a) => !a)}
          >
            {anchored ? <Link2 className="size-4" /> : <Link2Off className="size-4" />}
            {anchored ? 'Linked' : 'Free'}
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            onClick={() =>
              setTransforms((prev) =>
                applyZoom(prev, 1 / COMPARE_ZOOM_STEP, anchored, activeSide),
              )
            }
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums" aria-label="Zoom level">
            {Math.round(transforms[activeSide].zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            onClick={() =>
              setTransforms((prev) => applyZoom(prev, COMPARE_ZOOM_STEP, anchored, activeSide))
            }
          >
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
        {mode === 'side' ? (
          <div className="grid h-full grid-cols-2 gap-2 rounded-lg border">
            {pane('left', left, leftUrl, leftSorted)}
            {pane('right', right, rightUrl, rightSorted)}
          </div>
        ) : (
          overlayPane
        )}
      </div>
    </div>
  );
}
