/**
 * PhotoBento
 *
 * Asymmetric bento grid of photos. The newest (or explicitly "featured")
 * tile spans 2 rows × 2 cols; the rest are 1×1. Designed for the global
 * Photos browser and the patient timeline (replaces the uniform grid there).
 *
 * Tiles reuse PhotoCard for the image surface + hover overlay; the grid
 * itself controls sizing via row/col spans.
 *
 * When the gallery carries a selection, the grid adds two gestures over the
 * empty space between tiles (a press that lands on a tile itself belongs to
 * that tile's drag-link gesture):
 *  - Ctrl/Cmd-drag sweeps a rubber band; every tile it intersects is
 *    selected (added on top of the current selection, file-manager style).
 *    Escape mid-band cancels and restores the pre-band selection.
 *  - A plain press on empty space clears the selection — the quick escape
 *    hatch for a half-built link drop.
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PhotoRecord } from '@/types/photo';
import { cn } from '@/lib/utils';
import { marqueeDelta, marqueeRect, rectsIntersect } from '@/lib/utils/box-select';
import { PhotoCard } from './photo-card';

interface PhotoBentoProps {
  photos: PhotoRecord[];
  onPhotoClick?: (photo: PhotoRecord) => void;
  /**
   * Multi-select (⌘/Ctrl-click) for drag-the-selection linking: the selected
   * subset of `photos`, plus the toggle callback. Derive the subset from the
   * photos actually rendered so filtered-out tiles drop out of the carry.
   */
  selection?: PhotoRecord[];
  onSelectionChange?: (photo: PhotoRecord, selected: boolean) => void;
  /** Fired after a link or unlink saves from a drag that started on a selected tile. */
  onSaved?: () => void;
  /** Index of the tile to feature (2×2). Defaults to 0 (newest). Set to -1 to disable. */
  featuredIndex?: number;
  className?: string;
}

/** Pointer travel (px) before a band press counts as a box — plain clicks pass through. */
const BOX_START_PX = 6;

/** One live Ctrl-drag band. Kept in refs on purpose: every pointermove must
    not re-render the gallery (the same reasoning as PhotoCard's drag ghost). */
interface BoxSession {
  startX: number;
  startY: number;
  /** The selection as it stood when the band began — Escape restores it. */
  baseline: Set<string>;
  /** Ids the band itself added since the start (the restore set). */
  added: Set<string>;
  /** Ids announced as in-band by the last move; the delta of the next move. */
  announced: Set<string>;
  dragging: boolean;
}

export function PhotoBento({
  photos,
  onPhotoClick,
  selection,
  onSelectionChange,
  onSaved,
  featuredIndex = 0,
  className,
}: PhotoBentoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<BoxSession | null>(null);
  // Latest-props refs: the window listeners for a live band stay stable
  // across renders and read the current gallery through these.
  const photoByIdRef = useRef(new Map<string, PhotoRecord>());
  const onSelectRef = useRef(onSelectionChange);
  photoByIdRef.current = new Map(photos.map((p) => [p.id, p]));
  onSelectRef.current = onSelectionChange;

  const select = useCallback((id: string, selected: boolean) => {
    const record = photoByIdRef.current.get(id);
    if (record) onSelectRef.current?.(record, selected);
  }, []);

  const showMarquee = useCallback(() => {
    const el = marqueeRef.current;
    if (el) el.classList.remove('hidden');
  }, []);

  const placeMarquee = useCallback((rect: { left: number; top: number; width: number; height: number }) => {
    const el = marqueeRef.current;
    // The band rect is in viewport coordinates; the overlay is positioned
    // inside the container, so translate by the container's own offset.
    if (!el || !containerRef.current) return;
    const box = containerRef.current.getBoundingClientRect();
    el.style.left = `${rect.left - box.left}px`;
    el.style.top = `${rect.top - box.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }, []);

  const hideMarquee = useCallback(() => {
    const el = marqueeRef.current;
    if (el) {
      el.classList.add('hidden');
      el.style.width = '0px';
      el.style.height = '0px';
    }
  }, []);

  const endSession = useCallback(
    (cancel: boolean) => {
      const session = sessionRef.current;
      sessionRef.current = null;
      window.removeEventListener('pointermove', onSessionMove);
      window.removeEventListener('pointerup', onSessionUp);
      window.removeEventListener('pointercancel', onSessionCancel);
      window.removeEventListener('blur', onSessionCancel);
      window.removeEventListener('keydown', onSessionKey, true);
      document.body.style.userSelect = '';
      hideMarquee();
      // Cancel (Escape) or an aborted band unwinds what it added so the
      // selection is exactly what it was before the press.
      if (session && cancel) {
        for (const id of session.added) select(id, false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the session handlers are this component's stable identities
    [hideMarquee, select],
  );

  const onSessionMove = useCallback((ev: PointerEvent) => {
    const session = sessionRef.current;
    const container = containerRef.current;
    if (!session || !container) return;
    if (!session.dragging) {
      if (Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY) < BOX_START_PX) {
        return;
      }
      session.dragging = true;
      // Text selection fights the band once tiles start under it.
      document.body.style.userSelect = 'none';
      showMarquee();
    }
    const rect = marqueeRect(session.startX, session.startY, ev.clientX, ev.clientY);
    placeMarquee(rect);

    const inBand: string[] = [];
    for (const el of container.querySelectorAll<HTMLElement>('[data-photo-id]')) {
      const id = el.dataset.photoId;
      if (id && rectsIntersect(rect, el.getBoundingClientRect())) inBand.push(id);
    }
    const { gained, lost } = marqueeDelta({ inBandIds: inBand, announced: session.announced });
    for (const id of gained) {
      session.announced.add(id);
      if (!session.baseline.has(id)) session.added.add(id);
      select(id, true);
    }
    for (const id of lost) {
      session.announced.delete(id);
      // Swept out of the band mid-drag: only the band's own additions leave.
      if (session.added.has(id)) {
        session.added.delete(id);
        select(id, false);
      }
    }
    // ponytail: no edge auto-scroll — a band lives inside one viewport-full
    // of tiles; scroll, release, band again. Upgrade if long grids demand it.
  }, [placeMarquee, select, showMarquee]);

  const onSessionUp = useCallback(() => {
    // Keep whatever the band gathered.
    endSession(false);
  }, [endSession]);

  const onSessionCancel = useCallback(() => {
    endSession(true);
  }, [endSession]);

  // Capture-phase Escape: the band owns Escape while it is live — restore
  // and stop, before the galleries' own "Escape deselects everything".
  // Scroll page listeners react.
  const onSessionKey = useCallback((ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !sessionRef.current) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    endSession(true);
  }, [endSession]);

  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSelectionChange || !photos.length) return;
    // Tiles own their press (drag-link); only genuinely empty grid space
    // starts a band or clears.
    if (e.target !== e.currentTarget) return;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      sessionRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseline: selection ? new Set(selection.map((p) => p.id)) : new Set(),
        added: new Set(),
        announced: new Set(),
        dragging: false,
      };
      window.addEventListener('pointermove', onSessionMove);
      window.addEventListener('pointerup', onSessionUp);
      window.addEventListener('pointercancel', onSessionCancel);
      window.addEventListener('blur', onSessionCancel);
      window.addEventListener('keydown', onSessionKey, true);
      return;
    }

    // Plain press on empty space: the quick way out of a half-built
    // selection — unwind every currently selected tile.
    if (selection) {
      for (const photo of selection) onSelectionChange(photo, false);
    }
  };

  // A band never outlives the gallery it belongs to (dialog closed, filter
  // swapped, page changed mid-drag).
  useEffect(() => () => endSession(true), [endSession]);

  if (photos.length === 0) return null;

  const selectedIds = selection && selection.length > 0 ? new Set(selection.map((p) => p.id)) : null;

  return (
    <div
      ref={containerRef}
      onPointerDown={handleContainerPointerDown}
      onContextMenu={(e) => {
        // A band press needs a ctrl-modified pointerdown; on macOS that is
        // also the open-context-menu gesture — swallow it while selection
        // mode is live (the tiles guard themselves in PhotoCard).
        if ((e.ctrlKey || e.metaKey) && onSelectionChange) e.preventDefault();
      }}
      className={cn(
        'relative grid auto-rows-[170px] grid-cols-2 gap-3 sm:auto-rows-[200px] md:grid-cols-4',
        className,
      )}
    >
      {photos.map((photo, i) => {
        const featured = i === featuredIndex;
        return (
          <PhotoCard
            key={photo.id}
            photo={photo}
            onClick={() => onPhotoClick?.(photo)}
            isSelected={selectedIds?.has(photo.id) ?? false}
            selection={selection}
            onSelectionChange={
              onSelectionChange ? (selected) => onSelectionChange(photo, selected) : undefined
            }
            onSaved={onSaved}
            fillContainer
            className={cn(
              'h-full',
              featured && 'col-span-2 row-span-2',
            )}
          />
        );
      })}
      {/* Rubber band for Ctrl-drag box-select; geometry is applied
          imperatively by the session's move handler. */}
      <div
        ref={marqueeRef}
        aria-hidden
        className="pointer-events-none absolute z-20 hidden rounded-sm border border-primary bg-primary/10"
      />
    </div>
  );
}
