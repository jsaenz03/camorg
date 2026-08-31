/**
 * PhotoDetailDialog
 *
 * Radix Dialog overlay for a single photo. Shows a zoomable image viewer,
 * metadata, inline edit of clinical notes + subpart + lesion series, a body
 * map showing where on the patient the photo was taken, a one-click "mark
 * reviewed" (counts for the photo AND the patient), and soft-delete with a
 * confirmation step. Soft-deleted photos offer Restore instead. "Annotate"
 * replaces the dialog with a fullscreen filerobot editor (text/arrows/shapes)
 * — dynamically imported, and deliberately NOT nested in the Radix dialog:
 * the editor portals its save-modal/popovers/text-input to document.body,
 * where a Radix focus trap and pointer-events lockdown would disable them.
 *
 * Read + edit + delete all flow through photoService — no new routes.
 */

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  ArchiveRestore,
  CalendarCheck,
  Link2,
  Loader2,
  PenLine,
  Save,
  Trash2,
} from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { normalizeLesionGroup } from '@/lib/utils/lesion-group';
import {
  BILATERAL_BODY_PARTS,
  bodyPartDisplayLabel,
  type Laterality,
} from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import { formatCaptureDate } from '@/lib/utils/date-formatting';
import { notifyAttentionChanged } from '@/lib/services/notification-service';
import { photoReviewStatus } from '@/lib/utils/photo-review';
import { useBranding } from '@/components/branding-boot';
import { NotFoundError } from '@/lib/validators/errors';
import { PhotoViewer } from './photo-viewer';
import { BodyMapBadge } from '@/components/patient/body-map-badge';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

// ~1 MB editor stack (konva, styled-components) — load on demand only.
const PhotoAnnotator = dynamic(() => import('./photo-annotator'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

interface PhotoDetailDialogProps {
  photo: PhotoRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful edit or delete so the parent can refresh. */
  onChanged: () => void;
  /** Called when the photo has been deleted (parent usually navigates back or refreshes). */
  onDeleted?: (photoId: string) => void;
  /**
   * Open another photo in this dialog (used by the lesion-series strip to
   * jump between before/after shots without closing).
   */
  onOpenPhoto?: (photo: PhotoRecord) => void;
}

export function PhotoDetailDialog({
  photo,
  open,
  onOpenChange,
  onChanged,
  onDeleted,
  onOpenPhoto,
}: PhotoDetailDialogProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [annotate, setAnnotate] = useState(false);
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);

  const [subpart, setSubpart] = useState('');
  const [laterality, setLaterality] = useState<Laterality | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [lesionGroupInput, setLesionGroupInput] = useState('');
  const [reviewDueInput, setReviewDueInput] = useState('');
  const [lastReviewedAt, setLastReviewedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { reviewWarningDays } = useBranding();

  // Series picker data: other series names on this patient (chips) and the
  // sibling photos of this photo's saved series (thumbnail strip).
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  const [siblings, setSiblings] = useState<PhotoRecord[]>([]);

  // Load full-res image and seed form fields whenever the photo changes.
  const photoId = photo?.id;
  useEffect(() => {
    if (!photoId) return;
    let mounted = true;

    setIsLoadingImage(true);
    setImageUrl(null);

    photoService
      .exportPhotoAsDataUrl(photoId, false)
      .then((url) => {
        if (mounted) setImageUrl(url);
      })
      .catch(() => {
        if (mounted) toast.error('Failed to load image');
      })
      .finally(() => {
        if (mounted) setIsLoadingImage(false);
      });

    return () => {
      mounted = false;
    };
  }, [photoId]);

  // Sync form state when the photo changes.
  useEffect(() => {
    if (!photo) return;
    setSubpart(photo.subpart ?? '');
    setLaterality(photo.laterality);
    setClinicalNotes(photo.clinicalNotes ?? '');
    setLesionGroupInput(photo.lesionGroup ?? '');
    setReviewDueInput(photo.reviewDueAt ? format(photo.reviewDueAt, 'yyyy-MM-dd') : '');
    setLastReviewedAt(photo.lastReviewedAt);
    setConfirmDelete(false);
    setAnnotate(false);
  }, [photo]);

  // Series-name chips for this patient (the strip below covers siblings).
  const photoPatientId = photo?.patientId;
  useEffect(() => {
    if (!photoPatientId) return;
    let mounted = true;
    photoService
      .getLesionGroups(photoPatientId)
      .then((groups) => {
        if (mounted) setExistingGroups(groups);
      })
      .catch(() => {
        if (mounted) setExistingGroups([]);
      });
    return () => {
      mounted = false;
    };
  }, [photoPatientId]);

  // Siblings of the SAVED series (typing a new name doesn't reshuffle the
  // strip until the change is saved).
  const savedGroup = photo?.lesionGroup;
  useEffect(() => {
    if (!photoPatientId || !savedGroup) {
      setSiblings([]);
      return;
    }
    let mounted = true;
    photoService
      .getPhotosInGroup(photoPatientId, savedGroup)
      .then((list) => {
        if (mounted) setSiblings(list.filter((p) => p.id !== photoId));
      })
      .catch(() => {
        if (mounted) setSiblings([]);
      });
    return () => {
      mounted = false;
    };
  }, [photoPatientId, savedGroup, photoId]);

  if (!photo) return null;

  const isBilateral = BILATERAL_BODY_PARTS.has(photo.bodyPart);

  const photoAlt = `Photo of ${bodyPartDisplayLabel(photo.bodyPart, photo.laterality)}${photo.subpart ? `, ${photo.subpart}` : ''}`;

  // Live review-schedule hint from the date input (it saves with the form,
  // but the hint should reflect what the user is typing right now).
  const parsedReviewDue = reviewDueInput ? new Date(`${reviewDueInput}T00:00:00`) : null;
  const dueStatus = photoReviewStatus(parsedReviewDue, { warningDays: reviewWarningDays });
  const dueHint = (() => {
    if (!parsedReviewDue) {
      return 'Set a date and this photo lands on the dashboard alert list when its review is coming up or overdue.';
    }
    const due = format(parsedReviewDue, 'd MMM yyyy');
    if (dueStatus === 'overdue') return `Overdue — was due ${due}. It’s on the dashboard alert list.`;
    if (dueStatus === 'due-soon') return `Review coming up ${due} — it’s on the dashboard alert list.`;
    return `Scheduled for ${due}.`;
  })();

  // Annotating swaps the Radix dialog for a fullscreen overlay. The editor
  // portals its save-modal, option popovers and text input to document.body —
  // inside a Radix Dialog those are outside the focus trap and the layer's
  // pointer-events lockdown, leaving them unclickable and typing dead.
  if (annotate && imageUrl) {
    return (
      <div className="fixed inset-0 z-50 bg-background p-3 md:p-6">
        <div className="h-full w-full overflow-hidden rounded-xl border shadow-lg">
          <PhotoAnnotator
            src={imageUrl}
            alt={photoAlt}
            onSave={handleSaveAnnotation}
            onClose={() => setAnnotate(false)}
          />
        </div>
      </div>
    );
  }

  /** Save the annotated copy as a new photo; the original stays untouched. */
  async function handleSaveAnnotation(blob: Blob) {
    if (!photo) return;
    setIsSavingAnnotation(true);
    try {
      await photoService.saveAnnotatedImageAsNewPhoto(photo.id, blob);
      toast.success('Annotated copy saved as a new photo');
      setAnnotate(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save annotation');
    } finally {
      setIsSavingAnnotation(false);
    }
  }

  async function handleRestore() {
    if (!photo) return;
    setIsRestoring(true);
    try {
      await photoService.restorePhoto(photo.id);
      toast.success('Photo restored');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof NotFoundError) {
        toast.error('Photo no longer exists');
        onOpenChange(false);
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to restore photo');
      }
    } finally {
      setIsRestoring(false);
    }
  }

  /** One-click review: stamps this photo, clears its scheduled date, and
      counts as the patient's review. */
  async function handleReview() {
    if (!photo) return;
    setIsReviewing(true);
    try {
      const updated = await photoService.reviewPhoto(photo.id);
      setLastReviewedAt(updated.lastReviewedAt);
      setReviewDueInput('');
      notifyAttentionChanged();
      toast.success('Marked reviewed — this also counts as the patient’s review');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record the review');
    } finally {
      setIsReviewing(false);
    }
  }

  async function handleSave() {
    if (!photo) return;
    setIsSaving(true);
    try {
      await photoService.updatePhoto(photo.id, {
        laterality: isBilateral ? laterality : null,
        subpart: subpart.trim() || null,
        clinicalNotes: clinicalNotes.trim() || null,
        lesionGroup: normalizeLesionGroup(lesionGroupInput),
        reviewDueAt: parsedReviewDue,
      });
      toast.success('Photo updated');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update photo');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!photo) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    try {
      await photoService.deletePhoto(photo.id);
      toast.success('Photo deleted');
      onDeleted?.(photo.id);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof NotFoundError) {
        toast.error('Photo no longer exists');
        onOpenChange(false);
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to delete photo');
      }
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Bounded flex column: the dialog never exceeds the viewport. Below md
          the whole body is one scroll container; from md up the panes get a
          fixed height and scroll individually. */}
      <DialogContent className="flex max-h-[95dvh] w-full flex-col overflow-hidden p-0 sm:max-w-3xl md:max-w-4xl lg:max-w-5xl">
        <DialogHeader className="shrink-0 border-b p-4 sm:p-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-base">
            <Badge variant="secondary">
              {bodyPartDisplayLabel(photo.bodyPart, photo.laterality)}
            </Badge>
            {photo.subpart && <Badge variant="outline">{photo.subpart}</Badge>}
            {photo.isDeleted && <Badge variant="destructive">Deleted</Badge>}
            <span className="text-muted-foreground font-normal">
              {formatCaptureDate(photo.capturedAt)}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Photo details and metadata
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:h-[60vh] md:grid-cols-[1.4fr_1fr] md:overflow-hidden">
          {/* Image viewer: zoom/pan; Annotate opens a fullscreen editor */}
          <div className="relative flex h-[45vh] shrink-0 items-center justify-center bg-black/95 p-2 sm:p-4 md:h-auto">
            {isLoadingImage ? (
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            ) : imageUrl ? (
              <>
                <PhotoViewer
                  src={imageUrl}
                  alt={photoAlt}
                  className="h-full w-full"
                />
                {!photo.isDeleted && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="absolute left-3 top-3 gap-1.5"
                    disabled={isSaving || isDeleting || isSavingAnnotation}
                    onClick={() => setAnnotate(true)}
                  >
                    <PenLine className="size-4" />
                    Annotate
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Image unavailable</p>
            )}
          </div>

          {/* Metadata form. On md+ the pane scrolls under a sticky action
              bar, so Save/Delete are reachable without scrolling; on mobile
              the whole dialog body scrolls and the bar pins to its bottom
              once the form is in view. */}
          <div className="flex min-h-0 flex-col gap-4 border-t p-4 sm:p-6 md:overflow-y-auto md:border-l md:border-t-0">
            {/* Body map: where on the patient this photo was taken. The
                highlight follows the side toggle live for bilateral regions. */}
            <div className="space-y-1.5">
              <Label>Where on the body</Label>
              <div className="flex items-end gap-3">
                <div
                  className="rounded-lg bg-black/85 p-2"
                  title={`${bodyPartDisplayLabel(photo.bodyPart, isBilateral ? laterality : photo.laterality)} — body map`}
                >
                  <BodyMapBadge
                    bodyPart={photo.bodyPart}
                    laterality={isBilateral ? laterality : photo.laterality}
                    className="block h-32 w-auto"
                  />
                </div>
                <p className="pb-1 text-sm text-muted-foreground">
                  {bodyPartDisplayLabel(photo.bodyPart, isBilateral ? laterality : photo.laterality)}
                  {photo.subpart ? ` — ${photo.subpart}` : ''}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Captured</dt>
              <dd className="col-span-2">{formatCaptureDate(photo.capturedAt)}</dd>
              <dt className="text-muted-foreground">Last reviewed</dt>
              <dd className="col-span-2">
                {lastReviewedAt ? formatCaptureDate(lastReviewedAt) : 'Never'}
              </dd>
              <dt className="text-muted-foreground">File size</dt>
              <dd className="col-span-2">{(photo.fileSizeBytes / 1024).toFixed(1)} KB</dd>
            </dl>

            {!photo.isDeleted && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Review</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleReview}
                    disabled={isReviewing || isSaving || isDeleting || isSavingAnnotation}
                  >
                    {isReviewing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CalendarCheck className="size-4" />
                    )}
                    Mark reviewed
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="photo-review-due">Next review date (optional)</Label>
                  <Input
                    id="photo-review-due"
                    type="date"
                    value={reviewDueInput}
                    onChange={(e) => setReviewDueInput(e.target.value)}
                    disabled={isSaving || isDeleting || isReviewing}
                  />
                  <p className="text-xs text-muted-foreground">{dueHint}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mark reviewed records today for this photo, clears a scheduled
                  date, and counts as the patient’s review too.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="photo-series">Lesion series</Label>
              <Input
                id="photo-series"
                value={lesionGroupInput}
                onChange={(e) => setLesionGroupInput(e.target.value)}
                placeholder="e.g., Left cheek mole — before/after"
                maxLength={100}
                disabled={isSaving || isDeleting}
              />
              {existingGroups.filter((g) => g !== lesionGroupInput.trim()).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {existingGroups
                    .filter((g) => g !== lesionGroupInput.trim())
                    .map((group) => (
                      <button
                        key={group}
                        type="button"
                        disabled={isSaving || isDeleting}
                        onClick={() => setLesionGroupInput(group)}
                        title={`Use the existing series “${group}”`}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        <Link2 className="size-3" />
                        {group}
                      </button>
                    ))}
                </div>
              )}
              {siblings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Other {siblings.length === 1 ? 'photo' : 'photos'} in this series
                    (oldest first) — click to open:
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {siblings.map((sibling) => (
                      <SiblingThumb
                        key={sibling.id}
                        photo={sibling}
                        onOpen={() => onOpenPhoto?.(sibling)}
                      />
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Name a series to link before/after photos of the same lesion —
                they badge together in the timeline and can be filtered as one.
              </p>
            </div>

            {isBilateral && (
              <div className="space-y-2">
                <Label>Side</Label>
                <div
                  role="radiogroup"
                  aria-label="Patient's side"
                  className="flex w-fit gap-1 rounded-md border p-0.5"
                >
                  {(['left', 'right'] as Laterality[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      role="radio"
                      aria-checked={laterality === side}
                      disabled={isSaving || isDeleting}
                      onClick={() => setLaterality(side)}
                      className={cn(
                        'rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                        laterality === side
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {side}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  The patient&rsquo;s own {laterality ?? 'left/right'} side.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="photo-subpart">Subpart</Label>
              <Input
                id="photo-subpart"
                value={subpart}
                onChange={(e) => setSubpart(e.target.value)}
                placeholder="e.g., left anterior, medial aspect"
                maxLength={100}
                disabled={isSaving || isDeleting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="photo-notes">Clinical notes</Label>
              <Textarea
                id="photo-notes"
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                placeholder="Enter clinical observations, findings, or context…"
                className="min-h-32 resize-none"
                maxLength={2000}
                disabled={isSaving || isDeleting}
              />
              <p className="text-right text-xs text-muted-foreground">
                {clinicalNotes.length}/2000
              </p>
            </div>

            {/* Pinned action bar: negative margins span the pane padding so
                scrolling content slides underneath it, never past it. */}
            <div className="sticky bottom-0 -mx-4 mt-auto border-t bg-background px-4 pb-4 pt-3 sm:-mx-6 sm:px-6 sm:pb-6">
              {confirmDelete && (
                <p className="pb-2 text-xs text-destructive">
                  Click again to remove this photo — it can be restored while it
                  stays in deleted.
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                {photo.isDeleted ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRestore}
                    disabled={isSaving || isRestoring}
                  >
                    {isRestoring ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArchiveRestore className="size-4" />
                    )}
                    Restore photo
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={isSaving || isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    {confirmDelete ? 'Confirm delete' : 'Delete'}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isDeleting}
                >
                  {isSaving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact thumbnail for one sibling photo in the lesion series strip.
 * Clicking jumps the dialog to that photo (via onOpenPhoto).
 */
function SiblingThumb({ photo, onOpen }: { photo: PhotoRecord; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    photoService
      .exportPhotoAsDataUrl(photo.id, true)
      .then((u) => {
        if (mounted) setUrl(u);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [photo.id]);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Captured ${formatCaptureDate(photo.capturedAt)} — open this photo`}
      aria-label={`Open photo from ${formatCaptureDate(photo.capturedAt)} in the same series`}
      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {url ? (
        <img
          src={url}
          alt={`Photo from ${formatCaptureDate(photo.capturedAt)} in the same series`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-muted">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-center text-[9px] leading-3 text-white">
        {format(photo.capturedAt, 'd/M/yy')}
      </span>
    </button>
  );
}
