/**
 * PhotoDetailDialog
 *
 * Radix Dialog overlay for a single photo. Shows full-resolution image and
 * metadata, supports inline edit of clinical notes + subpart, and soft-delete
 * with a confirmation step.
 *
 * Read + edit + delete all flow through photoService — no new routes.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { BodyPartLabels } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import { formatCaptureDate } from '@/lib/utils/date-formatting';
import { NotFoundError } from '@/lib/validators/errors';
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

  const [subpart, setSubpart] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load full-res image and seed form fields whenever the photo changes.
  useEffect(() => {
    if (!photo) return;
    let mounted = true;

    setIsLoadingImage(true);
    setImageUrl(null);

    photoService
      .exportPhotoAsDataUrl(photo.id, false)
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
  }, [photo]);

  // Sync form state when the photo changes.
  useEffect(() => {
    if (!photo) return;
    setSubpart(photo.subpart ?? '');
    setClinicalNotes(photo.clinicalNotes ?? '');
    setConfirmDelete(false);
  }, [photo]);

  if (!photo) return null;

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
            <span className="text-muted-foreground font-normal">
              {formatCaptureDate(photo.capturedAt)}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Photo details and metadata
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          {/* Image */}
          <div className="flex items-center justify-center bg-black/95 p-2 sm:p-4 md:min-h-[400px]">
            {isLoadingImage ? (
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={`Photo of ${BodyPartLabels[photo.bodyPart]}${photo.subpart ? ` — ${photo.subpart}` : ''}`}
                className="max-h-[60vh] w-auto max-w-full rounded-md object-contain"
              />
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
                placeholder="Enter clinical observations, findings, or context..."
                className="min-h-32 resize-none"
                maxLength={2000}
                disabled={isSaving || isDeleting}
              />
              <p className="text-right text-xs text-muted-foreground">
                {clinicalNotes.length}/2000
              </p>
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
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
