/**
 * PhotoUpload Component
 *
 * Lets a clinician add existing image files to a patient's file: an Upload
 * button (file picker) plus drag-and-drop anywhere over the patient timeline.
 * Each file goes through the same metadata form and photoService.createPhoto
 * path as captured photos (including compression), one dialog at a time.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ImagePlus, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import type { Patient } from '@/types/patient';
import { photoService } from '@/lib/services/photo-service';
import { PhotoMetadataForm, type PhotoMetadataFormValues } from '@/components/photo/photo-metadata-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PhotoUploadProps {
  patient: Patient;
  /** Called after the last photo in a batch is saved. */
  onSaved: () => void;
}

// Mirrors photoRecordCreateSchema's mime union.
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function PhotoUpload({ patient, onSaved }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [index, setIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const currentFile = queue[index] ?? null;
  const dialogOpen = currentFile !== null;

  // Full-window drop target: show an overlay while files are dragged in,
  // then enqueue them. The overlay is visual only (pointer-events-none) —
  // the window listener is what actually receives the drop.
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setIsDragActive(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
        setIsDragActive(false);
      }
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setIsDragActive(false);
      acceptFiles(Array.from(event.dataTransfer?.files ?? []));
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  function acceptFiles(files: File[]) {
    const rejected: string[] = [];
    const valid: File[] = [];

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        rejected.push(file.name);
      } else if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} (over 20MB)`);
      } else {
        valid.push(file);
      }
    }

    if (rejected.length > 0) {
      toast.error(`Skipped ${rejected.join(', ')} — use JPEG, PNG, WebP or HEIC up to 20MB.`);
    }
    if (valid.length === 0) {
      return;
    }
    setQueue(valid);
    setIndex(0);
  }

  const handleFormSubmit = async (values: PhotoMetadataFormValues) => {
    if (!currentFile) {
      return;
    }
    setIsSaving(true);

    try {
      await photoService.createPhoto({
        patientId: patient.id,
        imageBlob: currentFile,
        mimeType: currentFile.type as 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp',
        bodyPart: values.bodyPart,
        subpart: values.subpart || null,
        clinicalNotes: values.clinicalNotes || null,
        // Fall back to the file's own timestamp (when it was taken), unless
        // the form back-dates it.
        capturedAt: values.capturedAt ?? new Date(currentFile.lastModified || Date.now()),
      });

      if (index + 1 < queue.length) {
        setIndex(index + 1);
      } else {
        const count = queue.length;
        setQueue([]);
        setIndex(0);
        toast.success(
          count === 1 ? 'Photo added to patient file' : `${count} photos added to patient file`
        );
        onSaved();
      }
    } catch (error) {
      console.error('Failed to save uploaded photo:', error);
      toast.error(
        error instanceof Error && error.message
          ? `Could not save ${currentFile.name}: ${error.message}`
          : `Could not save ${currentFile.name}. Please try again.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    const remaining = queue.length - index;
    setQueue([]);
    setIndex(0);
    if (remaining > 1) {
      toast.info(`Upload cancelled — ${remaining - 1} remaining photo(s) discarded`);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <UploadCloud className="size-4" />
        Upload
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(',')}
        multiple
        hidden
        onChange={(event) => {
          acceptFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />

      {isDragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-8 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-4 border-dashed border-primary p-12 text-center">
            <ImagePlus className="size-12 text-primary" />
            <p className="text-lg font-semibold">Drop photos to add them</p>
            <p className="text-sm text-muted-foreground">
              to {patient.name}&rsquo;s file — you&rsquo;ll add details before they save
            </p>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && !isSaving && handleCancel()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {queue.length > 1 ? `Photo ${index + 1} of ${queue.length}` : 'Add photo to file'}
            </DialogTitle>
            <DialogDescription>
              {currentFile?.name} · saved to {patient.name}
            </DialogDescription>
          </DialogHeader>

          {currentFile && <PhotoPreview file={currentFile} />}

          <PhotoMetadataForm
            onSubmit={handleFormSubmit}
            onCancel={handleCancel}
            isSubmitting={isSaving}
            defaultValues={{
              patientName: patient.name,
              patientDob: patient.dateOfBirth ? format(patient.dateOfBirth, 'dd/MM/yyyy') : '',
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function PhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) {
    return null;
  }
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export; blob URL preview */}
      <img src={url} alt="Photo to add" className="h-full w-full object-contain" />
    </div>
  );
}
