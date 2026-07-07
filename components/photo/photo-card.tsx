/**
 * PhotoCard Component
 *
 * Image-forward bento tile for a single photo. The image fills the tile;
 * body-part label + relative capture time sit in a compact persistent caption.
 * Optional hover overlay reveals the full capture date and clinical notes.
 *
 * Used in: patient timeline, home dashboard.
 */

'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { BodyPartLabels } from '@/types/body-part';
import { Badge } from '@/components/ui/badge';
import { photoService } from '@/lib/services/photo-service';
import { formatCaptureDate, formatRelativeTime } from '@/lib/utils/date-formatting';
import { cn } from '@/lib/utils';

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
    <button
      type="button"
      onClick={handleCardClick}
      aria-label={`Photo of ${BodyPartLabels[photo.bodyPart]}${photo.subpart ? `, ${photo.subpart}` : ''}, captured ${formatCaptureDate(photo.capturedAt)}`}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'active:translate-y-px',
        isSelected && 'ring-2 ring-primary',
        className,
      )}
    >
      {/* Image surface */}
      <div className={cn('relative w-full bg-muted', fillContainer ? 'flex-1' : 'aspect-square')}>
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
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        )}

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
  );
}
