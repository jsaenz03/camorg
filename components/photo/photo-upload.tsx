/**
 * PhotoUpload Component
 *
 * Lets a clinician add existing image files to a patient's file: an Upload
 * button (file picker) plus drag-and-drop anywhere over the patient timeline.
 * Each file goes through the same metadata form and photoService.createPhoto
 * path as captured photos (including compression), one dialog at a time.
 *
 * Without a `patient` prop it doubles as the Patients page's "new patient"
 * entry point: the patient fields stay editable and an exact name match adds
 * to that record, a new name creates one — the same find-or-create rules the
 * capture flow applies.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ImagePlus, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import type { Patient } from '@/types/patient';
import { consentStatus } from '@/types/patient';
import { patientService } from '@/lib/services/patient-service';
import { photoService } from '@/lib/services/photo-service';
import { confirmDialog } from '@/lib/utils/confirm';
import { parseDobInput } from '@/lib/utils/date-formatting';
import { RecordConsentDialog } from '@/components/patient/record-consent-dialog';
import { PhotoMetadataForm, type PhotoMetadataFormValues } from '@/components/photo/photo-metadata-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PhotoUploadProps {
  /** Fixed patient. Omit to resolve one from the form (Patients page flow). */
  patient?: Patient;
  /** Trigger button label. */
  label?: string;
  /** Called after the last photo in a batch is saved, with the patient id. */
  onSaved: (patientId: string) => void;
}

// Mirrors photoRecordCreateSchema's mime union minus HEIC: WebView2's canvas
// decoder can't reliably decode HEIC, so accepting it here produced files that
// fail at thumbnail time. HEIC remains valid at the schema level for captures.
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function PhotoUpload({ patient, label = 'Upload', onSaved }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [index, setIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  // Resolved on the first save of a batch when no patient was supplied; the
  // rest of the batch saves to the same record so a renamed field mid-batch
  // can't fragment the patient across two rows.
  const [resolvedPatient, setResolvedPatient] = useState<Patient | null>(null);
  // Opened when a batch finishes saving for a patient whose photo consent is
  // missing or expired — same prompt the capture flow shows after a save.
  const [consentPatient, setConsentPatient] = useState<Patient | null>(null);
  const [isConsentOpen, setIsConsentOpen] = useState(false);

  const currentFile = queue[index] ?? null;
  const dialogOpen = currentFile !== null;
  const activePatient = patient ?? resolvedPatient;

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
      toast.error(`Skipped ${rejected.join(', ')} — use JPEG, PNG or WebP up to 20MB.`);
    }
    if (valid.length === 0) {
      return;
    }
    setResolvedPatient(null);
    setQueue(valid);
    setIndex(0);
  }

  /**
   * Resolve who the photo belongs to. A fixed patient always wins; otherwise
   * an exact name match is used, a new name creates a patient (confirmed when
   * the name already exists), and a declined confirmation returns null so the
   * form stays open with its values intact.
   */
  async function resolvePatient(values: PhotoMetadataFormValues): Promise<Patient | null> {
    if (activePatient) {
      return activePatient;
    }

    const name = values.patientName.trim();
    const matches = await patientService.searchPatients(name);
    const existing = matches.find((p) => p.normalizedName === name.toLowerCase());

    if (existing) {
      // Keep the email in step with what was typed here — the same courtesy
      // the capture form pays a matched patient.
      const email = values.patientEmail.trim();
      if (email && email !== (existing.email ?? '')) {
        try {
          await patientService.updatePatient(existing.id, {
            name: existing.name,
            dateOfBirth: existing.dateOfBirth,
            email,
            consent: {
              givenAt: existing.consentGivenAt,
              scope: existing.consentScope,
              expiresAt: existing.consentExpiresAt,
            },
            review: { dueAt: existing.reviewDueAt },
          });
        } catch {
          toast.info("Couldn't save the patient's email — you can add it via Edit details.");
        }
      }
      setResolvedPatient(existing);
      return existing;
    }

    // Name-variant guard: without it, a typo silently fragments one patient's
    // record across two rows.
    if (
      (await patientService.isDuplicateName(name)) &&
      !(await confirmDialog(
        `A patient with this exact name already exists: “${name}”.\n\n` +
          'Create a separate patient with the same name?',
      ))
    ) {
      return null;
    }

    const created = await patientService.createPatient({
      name,
      dateOfBirth: parseDobInput(values.patientDob),
      email: values.patientEmail,
    });
    setResolvedPatient(created);
    toast.info(`Created new patient: ${created.name}`);
    return created;
  }

  const handleFormSubmit = async (values: PhotoMetadataFormValues) => {
    if (!currentFile) {
      return;
    }
    setIsSaving(true);

    try {
      const owner = await resolvePatient(values);
      if (!owner) {
        return;
      }

      await photoService.createPhoto({
        patientId: owner.id,
        imageBlob: currentFile,
        mimeType: currentFile.type as 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp',
        bodyPart: values.bodyPart,
        laterality: values.laterality ?? null,
        subpart: values.subpart || null,
        clinicalNotes: values.clinicalNotes || null,
        pinX: values.pinX ?? null,
        pinY: values.pinY ?? null,
        pinSpace: values.pinSpace ?? null,
        pinView: values.pinView ?? null,
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
        onSaved(owner.id);
        if (consentStatus(owner) !== 'valid') {
          setConsentPatient(owner);
          setIsConsentOpen(true);
        }
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

  /**
   * Discard the remaining queue. `accidental` marks the dialog-dismissal path
   * (outside click / Escape), which always confirms; the explicit Cancel
   * button confirms only when a batch would be lost. The source files stay on
   * disk either way — the lost work is the entered metadata.
   */
  const handleCancel = async (accidental = false) => {
    const remaining = queue.length - index;
    if (remaining <= 0) return;
    const message =
      remaining > 1
        ? `Discard ${remaining} photos still waiting to be added?`
        : 'Discard this photo?';
    if ((accidental || remaining > 1) && !(await confirmDialog(message))) {
      return;
    }
    setQueue([]);
    setIndex(0);
    setResolvedPatient(null);
    if (remaining > 1) {
      toast.info(`Upload cancelled — ${remaining} photo(s) discarded`);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <UploadCloud className="size-4" />
        {label}
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
              {activePatient
                ? `to ${activePatient.name}’s file — you’ll add details before they save`
                : 'to a patient’s file — you’ll choose the patient before they save'}
            </p>
          </div>
        </div>
      )}

      {/* Bounded column (the capture dialog's pattern): the header and the
          form's pinned action bar stay put, the panes scroll in between.
          Without the max-height the form grew past the window and Save fell
          out of reach. */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && !isSaving && handleCancel(true)}>
        <DialogContent className="flex max-h-[95dvh] flex-col overflow-hidden p-4 sm:max-w-3xl sm:p-6 md:max-w-4xl">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>
              {queue.length > 1 ? `Photo ${index + 1} of ${queue.length}` : 'Add photo to file'}
            </DialogTitle>
            <DialogDescription>
              {currentFile?.name}
              {activePatient
                ? ` · saved to ${activePatient.name}`
                : ' · enter the patient’s details below'}
            </DialogDescription>
          </DialogHeader>

          {currentFile && (
            <div className="@container flex min-h-0 flex-1 flex-col">
              {/* Two panes once the dialog itself is wide enough (@3xl = 48rem
                  of container width); below that the preview sits above the
                  form and both scroll independently. */}
              <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-6 @3xl:grid-cols-2 @3xl:grid-rows-1">
                {/* Preview only — the dialog title and description already
                    name the file and its destination, so a second card header
                    here would just eat the height the form needs on short
                    windows. */}
                <ScrollArea className="min-h-0">
                  <div className="flex min-h-full flex-col justify-center gap-2">
                    <PhotoPreview file={currentFile} />
                    <p className="text-xs text-muted-foreground">
                      {(currentFile.size / (1024 * 1024)).toFixed(1)} MB · JPEG, PNG or WebP
                    </p>
                  </div>
                </ScrollArea>

                {/* Metadata form — the card fills the column so the form's own
                    scroll region and pinned action bar (see PhotoMetadataForm)
                    do the work; Save never scrolls out of reach. */}
                <div className="flex min-h-0 flex-col">
                  <Card className="flex min-h-0 flex-1 flex-col">
                    <CardHeader className="shrink-0">
                      <CardTitle>Photo metadata</CardTitle>
                      <CardDescription>
                        {activePatient
                          ? 'Complete the form to save the photo'
                          : 'Name an existing patient or add a new one'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col">
                      <PhotoMetadataForm
                        onSubmit={handleFormSubmit}
                        onCancel={() => handleCancel(false)}
                        isSubmitting={isSaving}
                        patientLocked={activePatient !== null}
                        defaultValues={{
                          patientName: activePatient?.name ?? '',
                          patientDob: activePatient?.dateOfBirth
                            ? format(activePatient.dateOfBirth, 'dd/MM/yyyy')
                            : '',
                          patientEmail: activePatient?.email ?? '',
                        }}
                      />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {consentPatient && (
        <RecordConsentDialog
          patient={consentPatient}
          open={isConsentOpen}
          onOpenChange={setIsConsentOpen}
          onSaved={() => onSaved(consentPatient.id)}
        />
      )}
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
    <div className="relative aspect-video max-h-[30dvh] w-full overflow-hidden rounded-lg border bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export; blob URL preview */}
      <img src={url} alt="Photo to add" className="h-full w-full object-contain" />
    </div>
  );
}
