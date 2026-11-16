'use client';

/**
 * PhotoCompareDialog
 *
 * Two photos of a patient, side by side or stacked as an opacity overlay —
 * the wound-progression / before-after workflow. The panes, pickers and
 * lockstep zoom/pan live in PhotoCompareView, shared with the cross-patient
 * Compare page.
 */

import { useMemo } from 'react';
import type { PhotoRecord } from '@/types/photo';
import { comparePredecessor } from '@/lib/photo-compare';
import { PhotoCompareView } from '@/components/photo/photo-compare-view';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PhotoCompareDialogProps {
  photos: PhotoRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from a photo's Compare action: the right pane starts on this
      photo and the left on its predecessor — the previous capture in its
      lesion series when linked, otherwise the capture taken immediately
      before it. Omitted (header Compare button) = the newest-two default. */
  focusPhotoId?: string | null;
}

export function PhotoCompareDialog({ photos, open, onOpenChange, focusPhotoId }: PhotoCompareDialogProps) {
  // Newest first; default to the two most recent captures.
  const sorted = useMemo(
    () => [...photos].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()),
    [photos],
  );

  const focus = focusPhotoId ? (sorted.find((p) => p.id === focusPhotoId) ?? null) : null;
  const predecessor = focus ? comparePredecessor(focus, sorted) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-w-6xl flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compare photos</DialogTitle>
          <DialogDescription>
            Panes are anchored — they pan and zoom together. Toggle Anchor to move each photo
            freely.
          </DialogDescription>
        </DialogHeader>

        {sorted.length < 2 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
            This patient needs at least two photos to compare.
          </div>
        ) : (
          <PhotoCompareView
            leftPool={sorted}
            rightPool={sorted}
            leftLabel="Earlier / reference"
            rightLabel="Later / current"
            initialLeftId={focus ? (predecessor?.id ?? null) : undefined}
            initialRightId={focus ? focus.id : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
