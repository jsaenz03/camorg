/**
 * PhotoDetailDialog
 *
 * Radix Dialog overlay for a single photo. Shows a zoomable image viewer,
 * metadata, inline edit of clinical notes + subpart, and soft-delete with a
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
import { ArchiveRestore, Loader2, PenLine, Save, Trash2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { BodyPartLabels } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import { formatCaptureDate } from '@/lib/utils/date-formatting';
import { NotFoundError } from '@/lib/validators/errors';
import { PhotoViewer } from './photo-viewer';
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
}

export function PhotoDetailDialog({
  photo,
  open,
  onOpenChange,
  onChanged,
  onDeleted,
}: PhotoDetailDialogProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  // Bumped after an annotation is saved so the image reloads from disk.
  const [imageVersion, setImageVersion] = useState(0);
  const [annotate, setAnnotate] = useState(false);
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);

  const [subpart, setSubpart] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
  }, [photoId, imageVersion]);

  // Sync form state when the photo changes.
  useEffect(() => {
    if (!photo) return;
    setSubpart(photo.subpart ?? '');
    setClinicalNotes(photo.clinicalNotes ?? '');
    setConfirmDelete(false);
    setAnnotate(false);
  }, [photo]);

  if (!photo) return null;

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
            alt={`Photo of ${BodyPartLabels[photo.bodyPart]}${photo.subpart ? `, ${photo.subpart}` : ''}`}
            onSave={handleSaveAnnotation}
            onClose={() => setAnnotate(false)}
          />
        </div>
      </div>
    );
  }

  /** Flatten the annotation onto the stored image and refresh everything. */
  async function handleSaveAnnotation(blob: Blob) {
    if (!photo) return;
    setIsSavingAnnotation(true);
    try {
      await photoService.saveAnnotatedImage(photo.id, blob);
      toast.success('Annotation saved');
      setAnnotate(false);
      setImageVersion((v) => v + 1);
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

  async function handleSave() {
    if (!photo) return;
    setIsSaving(true);
    try {
      await photoService.updatePhoto(photo.id, {
        subpart: subpart.trim() || null,
        clinicalNotes: clinicalNotes.trim() || null,
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
      <DialogContent className="max-w-4xl p-0 sm:max-w-4xl">
        <DialogHeader className="border-b p-4 sm:p-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-base">
            <Badge variant="secondary">{BodyPartLabels[photo.bodyPart]}</Badge>
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

        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          {/* Image viewer: zoom/pan; Annotate opens a fullscreen editor */}
          <div className="relative flex items-center justify-center bg-black/95 p-2 sm:p-4 md:min-h-[400px]">
            {isLoadingImage ? (
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            ) : imageUrl ? (
              <>
                <PhotoViewer
                  src={imageUrl}
                  alt={`Photo of ${BodyPartLabels[photo.bodyPart]}${photo.subpart ? `, ${photo.subpart}` : ''}`}
                  className="h-[60vh] w-full"
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

          {/* Metadata form */}
          <div className="flex flex-col gap-4 border-t p-4 sm:p-6 md:border-l md:border-t-0">
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Captured</dt>
              <dd className="col-span-2">{formatCaptureDate(photo.capturedAt)}</dd>
              <dt className="text-muted-foreground">Body part</dt>
              <dd className="col-span-2">{BodyPartLabels[photo.bodyPart]}</dd>
              <dt className="text-muted-foreground">File size</dt>
              <dd className="col-span-2">{(photo.fileSizeBytes / 1024).toFixed(1)} KB</dd>
            </dl>

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

            <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
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

            {confirmDelete && (
              <p className="text-xs text-destructive">
                Click again to permanently remove this photo.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
