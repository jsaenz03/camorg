/**
 * PhotoBento
 *
 * Asymmetric bento grid of photos. The newest (or explicitly "featured")
 * tile spans 2 rows × 2 cols; the rest are 1×1. Designed for the global
 * Photos browser and the patient timeline (replaces the uniform grid there).
 *
 * Tiles reuse PhotoCard for the image surface + hover overlay; the grid
 * itself controls sizing via row/col spans.
 */

'use client';

import type { PhotoRecord } from '@/types/photo';
import { cn } from '@/lib/utils';
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

export function PhotoBento({
  photos,
  onPhotoClick,
  selection,
  onSelectionChange,
  onSaved,
  featuredIndex = 0,
  className,
}: PhotoBentoProps) {
  if (photos.length === 0) return null;

  const selectedIds = selection && selection.length > 0 ? new Set(selection.map((p) => p.id)) : null;

  return (
    <div
      className={cn(
        'grid auto-rows-[170px] grid-cols-2 gap-3 sm:auto-rows-[200px] md:grid-cols-4',
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
    </div>
  );
}
