/**
 * PhotoChronologyStrip
 *
 * Horizontal filmstrip of a patient's photos in capture order — oldest on
 * the left, newest on the right — pinned to a timeline line with the capture
 * date under each thumbnail. The dot under a thumbnail carries the photo's
 * review alert colour (red overdue, amber due soon — the bento tile badge's
 * derivation). Clicking a thumbnail hands the photo to the host (the patient
 * page opens the compare dialog on it); the newest-first bento below stays
 * the browsing surface.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { bodyPartDisplayLabel } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import { useBranding } from '@/components/branding-boot';
import { photoReviewStatus } from '@/lib/utils/photo-review';
import { formatCaptureDate } from '@/lib/utils/date-formatting';
import { cn } from '@/lib/utils';

interface PhotoChronologyStripProps {
  photos: PhotoRecord[];
  /** Clicking a thumbnail — the host opens the compare dialog on the photo. */
  onCompare: (photo: PhotoRecord) => void;
  className?: string;
}

function StripThumb({
  photo,
  onCompare,
  reviewNote,
}: {
  photo: PhotoRecord;
  onCompare: (photo: PhotoRecord) => void;
  /** " — Review overdue" / " — Review due" when the dot is coloured; the
      text alternative so the alert never rides on colour alone. */
  reviewNote?: string;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Same thumbnail path as the bento tiles (share the thumb cache).
  useEffect(() => {
    let mounted = true;
    photoService
      .exportPhotoAsDataUrl(photo.id, true)
      .then((url) => {
        if (mounted) setThumbUrl(url);
      })
      .catch(() => {
        if (mounted) setThumbUrl(null);
      });
    return () => {
      mounted = false;
    };
  }, [photo.id]);

  return (
    <button
      type="button"
      onClick={() => onCompare(photo)}
      title={`${formatCaptureDate(photo.capturedAt)} — compare with the previous photo${reviewNote ?? ''}`}
      aria-label={`Compare the photo of ${bodyPartDisplayLabel(photo.bodyPart, photo.laterality)} captured ${formatCaptureDate(photo.capturedAt)} with the previous one${reviewNote ?? ''}`}
      className="group relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </span>
      )}
    </button>
  );
}

export function PhotoChronologyStrip({ photos, onCompare, className }: PhotoChronologyStripProps) {
  const { reviewWarningDays } = useBranding();
  // Oldest first: the strip reads left → right as the story unfolded.
  const ordered = useMemo(
    () => [...photos].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()),
    [photos],
  );

  if (ordered.length === 0) return null;

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card shadow-sm', className)}>
      <div className="overflow-x-auto p-3">
        {/* Thumbnail (size-16) + gap-1.5 + half the dot (size-2) put the dot
            centres 4.625rem from the top — the line runs through them. Rem
            units so the interface-scale slider keeps them aligned. */}
        <div className="relative w-max">
          <span aria-hidden className="absolute inset-x-8 top-[4.625rem] z-0 h-px bg-border" />
          <ol className="relative flex items-start gap-3">
            {ordered.map((photo) => {
              // Same derivation and colours as the bento tile's review badge:
              // red when the scheduled review is overdue, amber while it is
              // only coming up, neutral hollow dot otherwise.
              const reviewCue = photoReviewStatus(photo.reviewDueAt, {
                warningDays: reviewWarningDays,
              });
              const reviewNote =
                reviewCue === 'overdue'
                  ? ' — Review overdue'
                  : reviewCue === 'due-soon'
                    ? ' — Review due'
                    : '';
              return (
                <li key={photo.id} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                  <StripThumb photo={photo} onCompare={onCompare} reviewNote={reviewNote} />
                  <span
                    aria-hidden
                    className={cn(
                      'relative z-10 size-2 rounded-full border-2',
                      reviewCue === 'overdue'
                        ? 'border-destructive bg-destructive'
                        : reviewCue === 'due-soon'
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-primary bg-background',
                    )}
                  />
                  <time
                    dateTime={format(photo.capturedAt, 'yyyy-MM-dd')}
                    title={formatCaptureDate(photo.capturedAt)}
                    className="whitespace-nowrap text-xs text-muted-foreground"
                  >
                    {format(photo.capturedAt, 'd/M/yy')}
                  </time>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
