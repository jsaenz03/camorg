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
import { AlarmClock, Link2, Loader2, Paperclip } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { BodyPartLabels } from '@/types/body-part';
import { Badge } from '@/components/ui/badge';
import { BodyMapBadge } from '@/components/patient/body-map-badge';
import { useBranding } from '@/components/branding-boot';
import { photoReviewStatus } from '@/lib/utils/photo-review';
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
  const { reviewWarningDays } = useBranding();
  // Scheduled-review cue (dashboard alerts use the same derivation).
  const reviewCue = photoReviewStatus(photo.reviewDueAt, { warningDays: reviewWarningDays });

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
  );
}
