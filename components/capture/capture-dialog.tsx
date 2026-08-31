/**
 * Capture Dialog
 *
 * The whole capture flow (camera / phone QR, pending phone-photo tray,
 * metadata form, save) in a modal, so capture opens in place — the sidebar,
 * dashboard, photos page, and a patient's timeline all pop it over the page
 * you are on instead of navigating away. Opening for a specific patient
 * prefills their details and, after save, hands the id to `onSaved` instead
 * of navigating; a discard confirm guards every destructive action, and
 * closing with an unsaved photo just parks it in the sessionStorage draft
 * (restored with a toast next time the dialog opens).
 *
 * The flow state lives in CaptureFlow, rendered as the dialog content, so
 * Radix unmounts it on close — camera released, state reset, same lifecycle
 * the old /capture page had on every visit. Mounted once by CaptureProvider;
 * the companion provider defers phone photos to this dialog while it is open
 * (setCaptureScreenActive) and stages them in the pending tray otherwise.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { format } from 'date-fns';
import { Camera, CameraOff, Smartphone, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLicence } from '@/lib/licence/licence-context';
import { CameraCapture } from '@/components/camera/camera-capture';
import { PhotoMetadataForm, type PhotoMetadataFormValues } from '@/components/photo/photo-metadata-form';
import { setCaptureScreenActive } from '@/components/companion/companion-provider';
import type {
  CapturedPhoto,
  RemoteCameraPhotoEvent,
} from '@/specs/001-role-you-are/contracts/camera-service';
import { remotePhotoToCapturedPhoto } from '@/lib/services/camera-service';
import {
  listPendingPhotos,
  loadPendingPhoto,
  storePendingPhoto,
  deletePendingPhoto,
  deleteAllPendingPhotos,
  type PendingPhotoEntry,
} from '@/lib/services/pending-photo-service';
import { photoService } from '@/lib/services/photo-service';
import { patientService } from '@/lib/services/patient-service';
import { companionService } from '@/lib/services/companion-service';
import { parseDobInput } from '@/lib/utils/date-formatting';
import {
  saveCaptureDraft,
  readCaptureDraft,
  clearCaptureDraft,
  draftToCapturedPhoto,
} from '@/lib/utils/capture-draft';
import { consentStatus } from '@/types/patient';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface CaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the patient fields (capture-for-patient from their timeline). */
  patientName?: string;
  patientDob?: string;
  /** Called with the patient id after a successful save; skips the timeline navigation. */
  onSaved?: (patientId: string) => void;
}

export function CaptureDialog({ open, onOpenChange, patientName, patientDob, onSaved }: CaptureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Width tiers override the default sm:max-w-lg; the layout inside keys
          off the dialog's own width via @container, not the viewport. */}
      <DialogContent className="max-h-[95dvh] overflow-y-auto p-4 sm:max-w-3xl sm:p-6 md:max-w-4xl lg:max-w-5xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {patientName ? `Capture photo — ${patientName}` : 'Capture photo'}
          </DialogTitle>
          <DialogDescription>
            Capture a clinical photograph and add patient metadata.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CaptureFlow
            patientName={patientName}
            patientDob={patientDob}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One capture visit: mounts on dialog open, unmounts (state reset) on close. */
function CaptureFlow({
  patientName,
  patientDob,
  onSaved,
  onClose,
}: {
  patientName?: string;
  patientDob?: string;
  onSaved?: (patientId: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pending, setPending] = useState<PendingPhotoEntry[]>([]);
  // Tray photo currently loaded into the form; its file is deleted on save
  // or discard, and it stays listed until then so nothing staged goes dark.
  const [activePendingId, setActivePendingId] = useState<string | null>(null);

  // Read-only licence gate — the capture flow is the core licensed capability.
  const { writable, loading: licenceLoading, openActivation } = useLicence();

  // Latest-state refs for the long-lived phone-photo listener.
  const stateRef = useRef({ capturedPhoto, writable, licenceLoading });
  stateRef.current = { capturedPhoto, writable, licenceLoading };

  // Restore an unsaved capture from a previous visit (the photo used to die
  // with the page on any navigation before "Save") and load the pending tray
  // (photos the phone sent while no capture was open). A restored draft that
  // came from the tray is re-linked so saving also clears the staged file.
  useEffect(() => {
    void (async () => {
      let entries: PendingPhotoEntry[] = [];
      try {
        entries = await listPendingPhotos();
      } catch {
        // Tray unreadable — capture still works; the draft restore below is
        // the safety net that matters for the current session.
      }
      const draft = readCaptureDraft();
      if (draft) {
        const linked = entries.find((e) => e.capturedAt === draft.capturedAt);
        if (linked) setActivePendingId(linked.id);
        try {
          const photo = await draftToCapturedPhoto(draft);
          setCapturedPhoto(photo);
          toast.info('Restored your unsaved photo from earlier — save it or retake.');
        } catch {
          clearCaptureDraft();
        }
      }
      setPending(entries);
    })();
  }, []);

  // One owner per photo while the dialog is open: the companion provider's
  // global listener defers (setCaptureScreenActive). A photo that arrives
  // with nothing under review goes straight into the form, same as the
  // built-in camera; otherwise it is staged in the tray below instead of
  // silently replacing the photo being reviewed.
  useEffect(() => {
    setCaptureScreenActive(true);
    let unlistenPhoto: UnlistenFn | undefined;
    void (async () => {
      unlistenPhoto = await listen<RemoteCameraPhotoEvent>(
        'remote-camera-photo',
        async (event) => {
          try {
            const photo = await remotePhotoToCapturedPhoto(event.payload.data);
            if (stateRef.current.capturedPhoto || !stateRef.current.writable) {
              const entry = await storePendingPhoto(photo);
              setPending((p) => [...p, entry].sort((a, b) => a.capturedAt - b.capturedAt));
              toast('Photo received from your phone', {
                description: 'It is waiting in the review tray below.',
              });
              return;
            }
            setCapturedPhoto(photo);
            if (!saveCaptureDraft(photo)) {
              console.warn('[capture] draft could not be persisted (storage quota)');
            }
            toast.success('Photo captured');
          } catch (error) {
            console.error('Failed to process photo from phone:', error);
            toast.error('Received the photo from your phone but could not read it. Try again.');
          }
        },
      );
    })();
    return () => {
      setCaptureScreenActive(false);
      unlistenPhoto?.();
    };
  }, []);

  // Last line of defence for window close / reload while a capture is unsaved
  // (closing the dialog itself is covered by the sessionStorage draft).
  useEffect(() => {
    if (!capturedPhoto) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [capturedPhoto]);

  const handlePhotoCaptured = (photo: CapturedPhoto) => {
    setCapturedPhoto(photo);
    if (!saveCaptureDraft(photo)) {
      console.warn('[capture] draft could not be persisted (storage quota)');
    }
    toast.success('Photo captured');
  };

  /** Load a staged phone photo into the form (replaces any photo under review, confirmed). */
  const handleUsePending = async (id: string) => {
    if (activePendingId === id) return;
    if (
      capturedPhoto &&
      !window.confirm('Replace the photo currently being reviewed? It hasn’t been saved.')
    ) {
      return;
    }
    try {
      const photo = await loadPendingPhoto(id);
      setActivePendingId(id);
      setCapturedPhoto(photo);
      // Best-effort mirror; the staged file is the real recovery path here.
      saveCaptureDraft(photo);
    } catch (error) {
      console.error('Failed to load pending photo:', error);
      toast.error('Could not open that photo.');
    }
  };

  /** Delete a staged photo. If it is the one under review, clear the form too. */
  const handleDeletePending = async (id: string) => {
    if (!window.confirm('Delete this photo? It hasn’t been saved.')) return;
    await deletePendingPhoto(id).catch(() => {});
    setPending((p) => p.filter((e) => e.id !== id));
    if (activePendingId === id) {
      setActivePendingId(null);
      setCapturedPhoto(null);
      clearCaptureDraft();
    }
  };

  /** Delete every staged phone photo; clears the form if one is under review. */
  const handleDeleteAllPending = async () => {
    if (
      !window.confirm(
        `Delete all ${pending.length === 1 ? 'photo' : `${pending.length} photos`} waiting from your phone? They haven’t been saved.`,
      )
    ) {
      return;
    }
    await deleteAllPendingPhotos().catch(() => {});
    setPending([]);
    if (activePendingId) {
      setActivePendingId(null);
      setCapturedPhoto(null);
      clearCaptureDraft();
    }
    toast.info('Phone photos discarded');
  };

  /**
   * Handle form submission - save photo with metadata
   */
  const handleFormSubmit = async (formData: PhotoMetadataFormValues) => {
    if (!capturedPhoto) {
      toast.error('No photo captured');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Find or create patient. Capture-for-patient prefills the exact
      // name, which resolves to the existing record — but a renamed or
      // typo'd match still goes through the same search as before.
      const patients = await patientService.searchPatients(formData.patientName);
      const exactMatch = patients.find(
        (p) => p.normalizedName === formData.patientName.trim().toLowerCase()
      );

      let patientId: string;

      if (exactMatch) {
        patientId = exactMatch.id;
        // Surface missing/expired photo consent without blocking the capture —
        // record consent via Edit details on the patient's timeline page.
        if (consentStatus(exactMatch) !== 'valid') {
          toast.warning(
            consentStatus(exactMatch) === 'expired'
              ? 'This patient’s photo consent has expired.'
              : 'No photo consent on record for this patient.',
            { description: 'Record consent from the patient’s timeline page (Edit details).' },
          );
        }
      } else {
        // Name-variant guard: without this, "Jon Smith" vs "John Smith" or a
        // typo silently fragments one patient's record across two rows.
        const duplicate = await patientService.isDuplicateName(formData.patientName);
        if (
          duplicate &&
          !window.confirm(
            `A patient with this exact name already exists: “${formData.patientName.trim()}”.\n\n` +
              'Attach the photo to their record by choosing their name from search instead.\n\n' +
              'Create a separate patient anyway?',
          )
        ) {
          return; // keep the photo + form so the user can fix the name
        }
        const newPatient = await patientService.createPatient({
          name: formData.patientName,
          dateOfBirth: parseDobInput(formData.patientDob),
        });
        patientId = newPatient.id;
        toast.info(`Created new patient: ${formData.patientName}`);
      }

      // 2. Create photo record (honour an optional capture-date override).
      await photoService.createPhoto({
        patientId,
        imageBlob: capturedPhoto.blob,
        mimeType: capturedPhoto.blob.type as 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp',
        bodyPart: formData.bodyPart,
        laterality: formData.laterality ?? null,
        subpart: formData.subpart || null,
        clinicalNotes: formData.clinicalNotes || null,
        capturedAt: formData.capturedAt ?? capturedPhoto.capturedAt,
      });

      toast.success('Photo saved');
      clearCaptureDraft();
      // The staged copy has done its job once the photo is in the library.
      if (activePendingId) {
        const stagedId = activePendingId;
        await deletePendingPhoto(stagedId).catch(() => {});
        setPending((p) => p.filter((e) => e.id !== stagedId));
        setActivePendingId(null);
      }
      // Refresh the phone link's shared library (no-op when no session is
      // open) so the phone can review the new photo immediately.
      void companionService.publish().catch(() => {});

      // 3. Stay in place when capturing for a known patient; otherwise show
      // the new photo on the patient's timeline.
      if (onSaved) {
        onSaved(patientId);
      } else {
        router.push(`/patients/view?id=${patientId}`);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save photo:', error);

      if (error instanceof Error) {
        if (error.name === 'StorageUnavailableError') {
          toast.error(error.message, {
            description:
              'Reconnect the drive (if it’s a network or cloud folder), or an administrator can choose a different folder in Settings → Storage.',
            action: {
              label: 'Settings',
              onClick: () => router.push('/settings'),
            },
          });
        } else if (error.name === 'StorageQuotaError') {
          toast.error('Storage quota exceeded. Delete old photos or free up disk space.');
        } else if (error.name === 'ValidationError') {
          toast.error(`Validation error: ${error.message}`);
        } else {
          toast.error(`Failed to save photo: ${error.message}`);
        }
      } else {
        toast.error('Failed to save photo. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Discard the photo under review (confirmed — until it is saved the photo
   * has no other copy, except a staged tray photo whose file goes with it).
   */
  const discardCaptured = async () => {
    if (activePendingId) {
      const stagedId = activePendingId;
      await deletePendingPhoto(stagedId).catch(() => {});
      setPending((p) => p.filter((e) => e.id !== stagedId));
      setActivePendingId(null);
    }
    setCapturedPhoto(null);
    clearCaptureDraft();
  };

  /**
   * Handle cancel - discard captured photo and start over (confirmed — the
   * photo has no other copy until it is saved)
   */
  const handleCancel = async () => {
    if (!window.confirm('Discard this photo? It hasn’t been saved.')) return;
    await discardCaptured();
    toast.info('Photo discarded');
  };

  /**
   * Handle retake - discard captured photo and show camera again (confirmed,
   * same reason as cancel)
   */
  const handleRetake = async () => {
    if (!window.confirm('Retake? The current photo will be discarded.')) return;
    await discardCaptured();
  };

  // Read-only licence gate — the capture flow is the core licensed capability.
  if (!licenceLoading && !writable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CameraOff className="size-5 text-destructive" />
            Capture unavailable
          </CardTitle>
          <CardDescription>
            Camog is in read-only mode. Existing patients and photos remain
            viewable, but capturing and editing are disabled until a licence
            is activated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={openActivation}>Activate Camog</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="@container space-y-6">
      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-5" />
              From your phone
            </CardTitle>
            <CardDescription>
              {pending.length === 1
                ? 'One photo is waiting — open it to save it, or delete it.'
                : `${pending.length} photos are waiting — open each one to save it, or delete them all.`}
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleDeleteAllPending()}
                disabled={isSubmitting}
              >
                <Trash2 className="size-4" />
                Delete all
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {pending.map((entry) => {
                const inReview = entry.id === activePendingId;
                return (
                  <div key={entry.id} className="w-24 space-y-1">
                    <div className="relative">
                      <button
                        type="button"
                        disabled={inReview || isSubmitting}
                        onClick={() => void handleUsePending(entry.id)}
                        className={`block w-full overflow-hidden rounded-lg border transition-colors ${
                          inReview
                            ? 'border-primary ring-2 ring-primary'
                            : 'hover:border-primary'
                        }`}
                        aria-label={`Open photo taken ${format(
                          new Date(entry.capturedAt),
                          'dd/MM/yyyy, h:mm a',
                        )}`}
                      >
                        <img src={entry.thumbDataUrl} alt="" className="size-24 object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePending(entry.id)}
                        className="absolute -right-2.5 -top-2.5 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm"
                        aria-label="Delete this photo"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <p className="text-center text-[10px] leading-tight text-muted-foreground">
                      {inReview ? 'In review' : format(new Date(entry.capturedAt), 'd/M h:mm a')}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two panes once the dialog itself is wide enough (@3xl = 48rem of
          container width) — independent of the window size. */}
      <div className="grid gap-6 @3xl:grid-cols-2">
        {/* Left: Camera or Captured Photo */}
        <div>
          {!capturedPhoto ? (
            <CameraCapture onPhotoCaptured={handlePhotoCaptured} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Captured photo</CardTitle>
                <CardDescription>Review and add metadata to save</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <img
                    src={capturedPhoto.dataUrl}
                    alt="Captured photo"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleRetake}
                    className="flex-1"
                    disabled={isSubmitting}
                  >
                    Retake
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Size: {(capturedPhoto.blob.size / 1024).toFixed(1)} KB</p>
                  <p>
                    Dimensions: {capturedPhoto.width} × {capturedPhoto.height}
                  </p>
                  <p>Captured: {capturedPhoto.capturedAt.toLocaleTimeString()}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Metadata Form */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Photo metadata</CardTitle>
              <CardDescription>
                {capturedPhoto
                  ? 'Complete the form to save the photo'
                  : 'Capture a photo to continue'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {capturedPhoto ? (
                <PhotoMetadataForm
                  onSubmit={handleFormSubmit}
                  onCancel={handleCancel}
                  isSubmitting={isSubmitting}
                  defaultValues={{
                    patientName: patientName ?? '',
                    patientDob: patientDob ?? '',
                  }}
                />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Camera className="mx-auto mb-4 size-12 opacity-40" />
                  <p>Capture a photo to enable metadata entry</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
