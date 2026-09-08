/**
 * PhotoCard Component
 *
 * Image-forward bento tile for a single photo. The image fills the tile;
 * body-part label + relative capture time sit in a compact persistent caption.
 * Optional hover overlay reveals the full capture date and clinical notes.
 *
 * Press-drag onto another tile links the two into one lesion series (the
 * confirm dialog carries the series name). Like DashboardCanvas this is
 * pointer-event based, NOT HTML5 drag & drop: WKWebView (the Tauri shell)
 * cancels in-page drag sessions, so the native API never fires there.
 *
 * Used in: patient timeline, home dashboard.
 */

'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, Link2, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import type { PhotoRecord } from '@/types/photo';
import { BodyPartLabels } from '@/types/body-part';
import { Badge } from '@/components/ui/badge';
import { BodyMapBadge } from '@/components/patient/body-map-badge';
import { useBranding } from '@/components/branding-boot';
import { photoReviewStatus } from '@/lib/utils/photo-review';
import { resolvePhotoLink, type PhotoLinkPlan } from '@/lib/utils/photo-link';
import { photoService } from '@/lib/services/photo-service';
import { formatCaptureDate, formatRelativeTime } from '@/lib/utils/date-formatting';
import { cn } from '@/lib/utils';
import { PhotoLinkDialog } from './photo-link-dialog';

/** Movement (px) before a press counts as a drag — plain clicks pass through. */
const DRAG_THRESHOLD_PX = 6;
/** Pointer this close to the viewport edge auto-scrolls while dragging. */
const AUTOSCROLL_EDGE_PX = 60;

/**
 * Drop registry + live drag state shared by every open PhotoCard (timeline,
 * photos browser — any two galleries on screen participate). One drag at a
 * time: cards subscribe for their source/target visuals and register their
 * element so the dragging card can hit-test for the drop target.
 */
const dropTargets = new Map<HTMLElement, PhotoRecord>();
const dragListeners = new Set<() => void>();
const DRAG_IDLE: { sourceId: string | null; targetId: string | null } = {
  sourceId: null,
  targetId: null,
};
let dragSnapshot = DRAG_IDLE;

function setDragSession(sourceId: string | null, targetId: string | null) {
  const next = sourceId === null ? DRAG_IDLE : { sourceId, targetId };
  if (
    next === dragSnapshot ||
    (next.sourceId === dragSnapshot.sourceId && next.targetId === dragSnapshot.targetId)
  ) {
    return;
  }
  dragSnapshot = next;
  for (const listener of dragListeners) listener();
}

function subscribeDrag(listener: () => void) {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

/**
 * The drag preview's live pointer position + mounted element. Kept out of
 * React state on purpose: the ghost tracks the pointer on every pointermove,
 * which must not re-render the gallery — the move handler positions the
 * element imperatively (compositor-only, no layout).
 */
const dragGhost: { el: HTMLElement | null; x: number; y: number } = {
  el: null,
  x: 0,
  y: 0,
};

function positionDragGhost() {
  if (dragGhost.el) {
    // Centred on the pointer with a slight tilt, so the tile reads as
    // "picked up" rather than following the cursor dead-centre.
    dragGhost.el.style.transform = `translate3d(${dragGhost.x}px, ${dragGhost.y}px, 0) translate(-50%, -50%) rotate(2deg)`;
  }
}

interface PhotoCardProps {
  photo: PhotoRecord;
  onClick?: () => void;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  /** Tone of the tile surface. Default uses card tokens. */
  className?: string;
  /**
   * Stretch the image to fill the card's available height (drops the fixed
   * aspect-square). Used by bento layouts where the grid controls sizing.
   */
  fillContainer?: boolean;
}

export function PhotoCard({
  photo,
  onClick,
  isSelected = false,
  showCheckbox = false,
  onSelectionChange,
  className,
  fillContainer = false,
}: PhotoCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { reviewWarningDays } = useBranding();
  // Scheduled-review cue (dashboard alerts use the same derivation).
  const reviewCue = photoReviewStatus(photo.reviewDueAt, { warningDays: reviewWarningDays });

  // Press-drag linking: this card's visuals come from the shared drag state,
  // and a landed drop opens the confirm dialog with both photos. The server
  // snapshot (DRAG_IDLE, the same object the store rests at) keeps React's
  // SSR/prerender path happy — galleries render client-side only today.
  const dragVisual = useSyncExternalStore(subscribeDrag, () => dragSnapshot, () => DRAG_IDLE);
  const isDragSource = dragVisual.sourceId === photo.id;
  const isDropTarget = dragVisual.targetId === photo.id;
  const [linkRequest, setLinkRequest] = useState<{
    source: PhotoRecord;
    target: PhotoRecord;
    plan: PhotoLinkPlan;
  } | null>(null);
  // A drag that just ended must not also open the detail dialog (the click
  // that trails a release over this same card).
  const suppressClickRef = useRef(false);
  const teardownRef = useRef<(() => void) | null>(null);
  useEffect(() => () => teardownRef.current?.(), []);

  /** Register this tile as a drop target for the hit-test on release. */
  const tileRef = useRef<HTMLElement | null>(null);
  const registerDropTarget = (el: HTMLElement | null) => {
    if (el) {
      tileRef.current = el;
      dropTargets.set(el, photo);
    } else if (tileRef.current) {
      dropTargets.delete(tileRef.current);
      tileRef.current = null;
    }
  };

  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
    // Touch keeps its native scroll gestures; linking is a mouse/pen
    // interaction (touch users link via the detail dialog).
    if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return;
    // Clear any stale suppression (e.g. a drag aborted by pointercancel/blur,
    // where no click ever fired) — this press's own click must go through.
    suppressClickRef.current = false;
    if (teardownRef.current) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const bodySelectBefore = document.body.style.userSelect;
    const bodyCursorBefore = document.body.style.cursor;
    const sourcePhoto = photo;
    let dragging = false;
    const hitTest = (x: number, y: number): PhotoRecord | null => {
      for (const [el, record] of dropTargets) {
        if (record.id === sourcePhoto.id) continue;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return record;
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        dragging = true;
        // Text selection fights the drag once tiles start sliding under it.
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      // The ghost follows the pointer imperatively (no re-render per move);
      // coords are stored even before it mounts so it appears in place.
      dragGhost.x = ev.clientX;
      dragGhost.y = ev.clientY;
      positionDragGhost();
      // Keep tiles below the fold reachable mid-drag.
      if (ev.clientY < AUTOSCROLL_EDGE_PX) window.scrollBy(0, -10);
      else if (ev.clientY > window.innerHeight - AUTOSCROLL_EDGE_PX) {
        window.scrollBy(0, 10);
      }
      setDragSession(sourcePhoto.id, hitTest(ev.clientX, ev.clientY)?.id ?? null);
    };

    const onUp = (ev: PointerEvent) => {
      if (dragging) {
        suppressClickRef.current = true;
        const target = hitTest(ev.clientX, ev.clientY);
        if (target) {
          const plan = resolvePhotoLink(sourcePhoto, target);
          if (!plan.ok) {
            if (plan.reason === 'cross-patient') {
              toast.error('Can’t link — these photos belong to different patients.');
            } else if (plan.reason === 'deleted') {
              toast.error('Deleted photos can’t be linked.');
            }
          } else {
            // Link onto another series, or — dropped on its own series —
            // unlink; either way the dialog confirms the change first.
            setLinkRequest({ source: sourcePhoto, target, plan });
          }
        }
      }
      teardown();
    };
    const onCancel = () => {
      if (dragging) suppressClickRef.current = true;
      teardown();
    };
    const onBlur = onCancel;

    const teardown = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      document.body.style.userSelect = bodySelectBefore;
      document.body.style.cursor = bodyCursorBefore;
      teardownRef.current = null;
      if (dragging) setDragSession(null, null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    teardownRef.current = teardown;
  }

  useEffect(() => {
    let mounted = true;

    async function loadThumbnail() {
      try {
        const url = await photoService.exportPhotoAsDataUrl(photo.id, true);
        if (mounted) {
          setThumbnailUrl(url);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to load thumbnail'));
          setIsLoading(false);
        }
      }
    }

    loadThumbnail();

    return () => {
      mounted = false;
    };
  }, [photo.id]);

  const handleCardClick = () => {
    // Consume the click that trails a drag release (same guard as the
    // dashboard canvas) — it must not open the detail dialog.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (showCheckbox && onSelectionChange) {
      onSelectionChange(!isSelected);
    } else if (onClick) {
      onClick();
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (onSelectionChange) {
      onSelectionChange(e.target.checked);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={registerDropTarget}
        onPointerDown={handlePointerDown}
        onClick={handleCardClick}
        aria-label={`Photo of ${BodyPartLabels[photo.bodyPart]}${photo.subpart ? `, ${photo.subpart}` : ''}, captured ${formatCaptureDate(photo.capturedAt)}`}
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all',
          'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'active:translate-y-px',
          isSelected && 'ring-2 ring-primary',
          // Drag linking: the tile being dragged fades, the tile under the
          // pointer lifts and lights up as the drop target.
          isDragSource && 'opacity-50',
          isDropTarget && 'scale-[1.02] ring-2 ring-primary ring-offset-2',
          className,
        )}
      >
        {/* Image surface */}
        <div className={cn('relative w-full bg-muted', fillContainer ? 'min-h-0 flex-1' : 'aspect-square')}>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-7 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">
              Failed to load image
            </div>
          )}
          {thumbnailUrl && !isLoading && !error && (
            <img
              src={thumbnailUrl}
              alt={`Photo of ${BodyPartLabels[photo.bodyPart]}${photo.subpart ? ` — ${photo.subpart}` : ''}`}
              // Absolutely positioned: a static h-full img gives WebKit an
              // unresolvable height during flex layout, so the uncropped image
              // inflated this container (min-height:auto), pushing the caption
              // and the body-map chip out past the clipped tile edge on wider
              // viewports. Filling the box instead keeps every overlay anchored.
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              // Native image drags would steal the press-drag linking gesture.
              draggable={false}
              loading="lazy"
            />
          )}

          {/* Top-left markers: soft-deleted (visible when the preference shows
              deleted photos), lesion-series badge, the scheduled-review cue,
              and the attached-documents indicator. */}
          {(photo.isDeleted ||
            photo.lesionGroup ||
            photo.attachmentCount > 0 ||
            (reviewCue !== 'none' && !photo.isDeleted)) && (
            <span className="pointer-events-none absolute left-2 top-2 flex max-w-[75%] flex-col items-start gap-1">
              {photo.isDeleted && (
                <span className="rounded-md bg-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Deleted
                </span>
              )}
              {photo.attachmentCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
                  title={`${photo.attachmentCount} attached ${photo.attachmentCount === 1 ? 'document' : 'documents'}`}
                >
                  <Paperclip className="size-3 shrink-0" />
                  {photo.attachmentCount}
                </span>
              )}
              {photo.lesionGroup && (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                  title={`Lesion series: ${photo.lesionGroup}`}
                >
                  <Link2 className="size-3 shrink-0" />
                  <span className="truncate">{photo.lesionGroup}</span>
                </span>
              )}
              {!photo.isDeleted && reviewCue !== 'none' && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white',
                    reviewCue === 'overdue' ? 'bg-destructive' : 'bg-amber-500',
                  )}
                  title={
                    reviewCue === 'overdue'
                      ? 'Photo review overdue — on the dashboard alert list'
                      : 'Photo review coming up — on the dashboard alert list'
                  }
                >
                  <AlarmClock className="size-3 shrink-0" />
                  {reviewCue === 'overdue' ? 'Review overdue' : 'Review due'}
                </span>
              )}
            </span>
          )}

          {/* Body-map indicator: where on the patient this was taken. Rendered
              regardless of image state so every tile carries it — a white chip
              (both colour modes) that reads over any photo. Sized to stay
              legible next to the photo rather than a speck in the corner. */}
          <span
            className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-white p-1 shadow-md ring-1 ring-black/10"
            title={`${BodyPartLabels[photo.bodyPart]}${photo.laterality ? ` (${photo.laterality})` : ''}`}
          >
            <BodyMapBadge
              bodyPart={photo.bodyPart}
              laterality={photo.laterality}
              className="block h-12 w-[30px]"
            />
          </span>

          {/* Selection checkbox */}
          {showCheckbox && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={handleCheckboxChange}
              className="absolute right-3 top-3 size-5 rounded border-input bg-background/80 text-primary accent-primary focus:ring-2 focus:ring-ring"
              aria-label={`Select photo from ${formatCaptureDate(photo.capturedAt)}`}
            />
          )}

          {/* Hover overlay: full date + notes */}
          {!error && !isLoading && (
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/0 to-black/0 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
              <p className="text-xs font-medium text-white drop-shadow">
                {formatCaptureDate(photo.capturedAt)}
              </p>
              {photo.clinicalNotes && (
                <p className="mt-1 line-clamp-2 text-xs text-white/80">
                  {photo.clinicalNotes}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Persistent caption */}
        <div className="flex items-center justify-between gap-2 p-3">
          <Badge variant="secondary" className="shrink-0">
            {BodyPartLabels[photo.bodyPart]}
          </Badge>
          <span className="truncate text-xs text-muted-foreground" title={formatCaptureDate(photo.capturedAt)}>
            {formatRelativeTime(photo.capturedAt)}
          </span>
        </div>
      </button>

      {linkRequest && (
        <PhotoLinkDialog
          source={linkRequest.source}
          target={linkRequest.target}
          plan={linkRequest.plan}
          open
          onOpenChange={(next) => {
            if (!next) setLinkRequest(null);
          }}
        />
      )}

      {/* Drag preview: a floating thumbnail that trails the pointer. Portalled
          to document.body — the tile's own hover/active transforms would make
          a fixed-position child relative to the tile instead of the viewport.
          Position is applied imperatively by the move handler. */}
      {isDragSource &&
        createPortal(
          <div
            ref={(el) => {
              dragGhost.el = el;
              positionDragGhost();
            }}
            aria-hidden
            className="pointer-events-none fixed left-0 top-0 z-50 h-24 w-24"
          >
            <div className="h-full w-full overflow-hidden rounded-xl border-2 border-primary bg-card shadow-2xl">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <Link2 className="size-6 text-muted-foreground" />
                </span>
              )}
            </div>
            <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
              <Link2 className="size-3.5" />
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
