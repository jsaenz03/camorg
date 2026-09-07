'use client';

/**
 * PhotoComparePickerDialog
 *
 * Thumbnail picker for one compare pane: a modal grid of the pane's (already
 * part/series-filtered) pool. Each cell names its capture date and body part
 * and carries a link badge when the photo belongs to a lesion series — the
 * linkage the old text dropdown kept invisible.
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { bodyPartDisplayLabel } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ponytail: unbounded module cache of thumbnail data URLs — the ceiling is
// one library's thumbs (a few hundred KB each at 200px); upgrade to an LRU
// only if compare pickers ever open over whole-organisation pools.
const thumbCache = new Map<string, string>();

function usePhotoThumb(id: string): string | null {
  const [url, setUrl] = useState<string | null>(() => thumbCache.get(id) ?? null);
  useEffect(() => {
    let cancelled = false;
    const cached = thumbCache.get(id);
    if (cached) {
      setUrl(cached);
      return;
    }
    photoService
      .exportPhotoAsDataUrl(id, true)
      .then((dataUrl) => {
        thumbCache.set(id, dataUrl);
        if (!cancelled) setUrl(dataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);
  return url;
}

function PickerCell({
  photo,
  selected,
  onSelect,
}: {
  photo: PhotoRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const thumb = usePhotoThumb(photo.id);
  const part = bodyPartDisplayLabel(photo.bodyPart, photo.laterality);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group relative overflow-hidden rounded-lg border text-left focus-visible:outline-none',
        selected ? 'border-primary ring-2 ring-primary' : 'border-transparent',
      )}
    >
      <div className="aspect-square w-full bg-muted">
        {thumb ? (
          <img
            src={thumb}
            alt={`${part} photo from ${format(photo.capturedAt, 'd MMM yyyy')}`}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full animate-pulse" />
        )}
      </div>
      <span className="block truncate px-1.5 py-1 text-xs text-muted-foreground">
        {format(photo.capturedAt, 'd MMM yyyy')} · {part}
        {photo.subpart ? ` · ${photo.subpart}` : ''}
      </span>
      {photo.lesionGroup && (
        <span className="absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
          <Link2 className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{photo.lesionGroup}</span>
        </span>
      )}
    </button>
  );
}

interface PhotoComparePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pane's filtered pool, newest first. */
  pool: PhotoRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Names the pane (patient name or role). */
  title: string;
}

export function PhotoComparePickerDialog({
  open,
  onOpenChange,
  pool,
  selectedId,
  onSelect,
  title,
}: PhotoComparePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80dvh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Choose a photo — {title}</DialogTitle>
          <DialogDescription>
            Tap a photo to load it into the pane. The link badge names the lesion series a photo
            belongs to.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {pool.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No photos match the current part and series filters.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {pool.map((photo) => (
                <PickerCell
                  key={photo.id}
                  photo={photo}
                  selected={photo.id === selectedId}
                  onSelect={() => {
                    onSelect(photo.id);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
