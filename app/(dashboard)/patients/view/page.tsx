/**
 * Patient Timeline Page
 *
 * Bento timeline of photos for a single patient, plus a back affordance.
 * Photo clicks open an in-place detail dialog (view / edit / delete).
 *
 * Static-export friendly: reads patient id from ?id= query param.
 */

'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { ArrowLeft, AlertCircle, Camera, CalendarCheck, FileText, Globe, Loader2, Lock, Pencil, ShieldCheck, ShieldAlert, Columns2 } from 'lucide-react';
import Link from 'next/link';
import type { Patient, ConsentScope } from '@/types/patient';
import { ConsentScopeLabels, consentStatus, reviewStatus } from '@/types/patient';
import type { PhotoRecord } from '@/types/photo';
import { PhotoTimeline } from '@/components/photo/photo-timeline';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { PhotoCompareDialog } from '@/components/photo/photo-compare-dialog';
import { PhotoUpload } from '@/components/photo/photo-upload';
import { useCapture, reviewFollowUpCapture } from '@/components/capture/capture-provider';
import { ReviewBadge } from '@/components/patient/review-badge';
import { PhotoReviewDueBadge } from '@/components/patient/photo-review-due-badge';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { usePhotos } from '@/lib/hooks/use-photos';
import { useAuth } from '@/lib/auth/auth-context';
import { useBranding } from '@/components/branding-boot';
import { patientService } from '@/lib/services/patient-service';
import { notifyAttentionChanged } from '@/lib/services/notification-service';
import { formatDateOfBirth, parseDobInput } from '@/lib/utils/date-formatting';
import { DobInput } from '@/components/patient/dob-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function PatientTimelineView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;
  const { clinician } = useAuth();
  const { reviewWarningDays, reviewStaleDays } = useBranding();
  const { openCapture } = useCapture();
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState<PhotoRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const { photos, isLoading: isLoadingPhotos, error, refresh } = usePhotos({
    patientId,
    // The "Show deleted photos" preference reveals soft-deleted captures in
    // the timeline (badged, restorable from the detail dialog).
    includeDeleted: clinician?.preferences.showDeletedPhotos ?? false,
  });

  // Memoised so the compare dialog's pick-seeding effect doesn't refire on
  // every parent render. (Photos due for review are flagged per tile in the
  // timeline below — alarm-clock cue on each photo card.)
  const activePhotos = useMemo(
    () => photos.filter((p) => !p.isDeleted),
    [photos],
  );

  useEffect(() => {
    if (!patientId) {
      toast.error('No patient selected');
      router.push('/patients');
      return;
    }

    async function loadPatient() {
      try {
        const data = await patientService.getPatientById(patientId);
        if (!data) {
          toast.error('Patient not found');
          router.push('/patients');
          return;
        }
        setPatient(data);
      } catch {
        toast.error('Failed to load patient');
        router.push('/patients');
      } finally {
        setIsLoadingPatient(false);
      }
    }

    loadPatient();
  }, [patientId, router]);

  const handlePhotoClick = useCallback((photo: PhotoRecord) => {
    setActivePhoto(photo);
    setDialogOpen(true);
  }, []);

  const handleBackClick = useCallback(() => {
    router.push('/patients');
  }, [router]);

  const handleDialogChanged = useCallback(() => {
    refresh();
    // Keep the patient card stats in sync (photo count, last photo time).
    if (patientId) {
      patientService
        .getPatientById(patientId)
        .then(setPatient)
        .catch(() => {});
    }
  }, [refresh, patientId]);

  const handleDialogDeleted = useCallback(() => {
    refresh();
    if (patientId) {
      patientService
        .getPatientById(patientId)
        .then(setPatient)
        .catch(() => {});
    }
  }, [refresh, patientId]);

  /** Uploaded photos go through the same save path as captured ones. */
  const handleUploadSaved = useCallback(() => {
    refresh();
    if (patientId) {
      patientService
        .getPatientById(patientId)
        .then(setPatient)
        .catch(() => {});
    }
  }, [refresh, patientId]);

  /** Opens capture for a review follow-up — prefilled with the original's
      location and linked to it via a shared lesion series on save. */
  const handleSnapReviewPhoto = useCallback(() => {
    if (!patient || !activePhoto) return;
    openCapture(
      reviewFollowUpCapture(activePhoto, {
        patientName: patient.name,
        patientDob: patient.dateOfBirth
          ? format(patient.dateOfBirth, 'd/M/yyyy')
          : undefined,
        onSaved: handleUploadSaved,
      }),
    );
  }, [patient, activePhoto, openCapture, handleUploadSaved]);

  if (isLoadingPatient || isLoadingPhotos) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <EmptyState
          icon={AlertCircle}
          tone="destructive"
          title="Error loading timeline"
          description={error.message}
          action={<Button onClick={handleBackClick}>Back to patients</Button>}
        />
      </div>
    );
  }

  if (!patient) return null;

  const consent = consentStatus(patient);
  const review = reviewStatus(patient, {
    warningDays: reviewWarningDays,
    staleDays: reviewStaleDays,
  });

  /** One-click "review done": stamps the review, clears the due date. */
  const handleMarkReviewed = async () => {
    setIsMarkingReviewed(true);
    try {
      const updated = await patientService.markReviewed(patient.id);
      setPatient(updated);
      notifyAttentionChanged();
      toast.success(`${patient.name} marked as reviewed`);
    } catch {
      toast.error('Failed to record the review. Please try again.');
    } finally {
      setIsMarkingReviewed(false);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <Button variant="ghost" onClick={handleBackClick} className="mb-4 -ml-2">
        <ArrowLeft className="size-4" />
        Back to patients
      </Button>

      <PageHeader
        title={patient.name}
        description={
          <>
            {patient.photoCount} {patient.photoCount === 1 ? 'photo' : 'photos'}
            {patient.dateOfBirth && <> · DOB {formatDateOfBirth(patient.dateOfBirth)}</>}
            {patient.ownerName && <> · Owner: {patient.ownerName}</>}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            {consent === 'valid' ? (
              <Badge variant="outline" className="gap-1 border-primary/40 text-primary" title={patient.consentExpiresAt ? `Expires ${format(patient.consentExpiresAt, 'dd/MM/yyyy')}` : 'No expiry set'}>
                <ShieldCheck className="size-3" />
                {ConsentScopeLabels[patient.consentScope ?? 'care']}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-destructive/40 text-destructive"
                title={consent === 'expired' ? 'Photo consent has expired — record new consent in Edit details' : 'No photo consent on record — add one in Edit details'}
              >
                <ShieldAlert className="size-3" />
                {consent === 'expired' ? 'Consent expired' : 'No consent'}
              </Badge>
            )}
            <ReviewBadge patient={patient} />
            <Badge variant="outline" className="gap-1">
              {patient.isOrgShared ? (
                <>
                  <Globe className="size-3" /> Org-wide
                </>
              ) : (
                <>
                  <Lock className="size-3" /> Private
                </>
              )}
            </Badge>
            {review === 'overdue' && (
              <Button variant="outline" onClick={handleMarkReviewed} disabled={isMarkingReviewed}>
                {isMarkingReviewed ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                Mark reviewed
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsEditOpen(true)}>
              <Pencil className="size-4" />
              Edit details
            </Button>
            <Button
              variant="outline"
              onClick={() => setCompareOpen(true)}
              disabled={patient.photoCount < 2}
              title={patient.photoCount < 2 ? 'Needs at least two photos' : 'Compare two photos side by side'}
            >
              <Columns2 className="size-4" />
              Compare
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/patients/report?id=${patient.id}`}>
                <FileText className="size-4" />
                Report
              </Link>
            </Button>
            <PhotoUpload patient={patient} onSaved={handleUploadSaved} />
            <Button
              onClick={() =>
                openCapture({
                  patientName: patient.name,
                  patientDob: patient.dateOfBirth
                    ? format(patient.dateOfBirth, 'd/M/yyyy')
                    : undefined,
                  onSaved: handleUploadSaved,
                })
              }
            >
              <Camera className="size-4" />
              Capture
            </Button>
          </div>
        }
      />

      {consent !== 'valid' && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {consent === 'expired'
            ? 'This patient’s photo consent has expired. Record new consent before capturing further photos.'
            : 'No photo consent on record for this patient. Consider recording consent via Edit details.'}
        </div>
      )}

      {review === 'overdue' && patient.reviewDueAt && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          This patient’s review was due {format(patient.reviewDueAt, 'd MMM yyyy')} — use
          “Mark reviewed” once done, or reschedule via Edit details.
        </div>
      )}
      {review === 'stale' && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          No review scheduled for this patient and the last activity was a while ago —
          consider setting a review date via Edit details.
        </div>
      )}

      <PhotoTimeline photos={photos} onPhotoClick={handlePhotoClick} showFilter />

      <EditPatientDialog
        key={`${patient.id}:${patient.updatedAt.getTime()}`}
        patient={patient}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        onSaved={setPatient}
      />

      <PhotoDetailDialog
        photo={activePhoto}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onChanged={handleDialogChanged}
        onDeleted={handleDialogDeleted}
        onOpenPhoto={handlePhotoClick}
        onSnapReviewPhoto={handleSnapReviewPhoto}
      />

      <PhotoCompareDialog
        photos={activePhotos}
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />
    </div>
  );
}

export default function PatientTimelinePage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        </div>
      }
    >
      <PatientTimelineView />
    </Suspense>
  );
}

const editPatientSchema = z.object({
  name: z
    .string()
    .min(1, 'Patient name is required')
    .max(100, 'Patient name must be 100 characters or less')
    .trim(),
  dateOfBirth: z
    .string()
    .refine(
      (v) => !v.trim() || parseDobInput(v) !== null,
      'Enter a valid date, e.g. 4/2/85 or 04/02/1985',
    ),
  /** '' = no consent; otherwise a ConsentScope. */
  consentScope: z.enum(['', 'care', 'education', 'research']),
  /** Optional ISO date (yyyy-mm-dd); '' = no expiry. */
  consentExpiresAt: z
    .string()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date')
    .refine((v) => !v || new Date(v).getTime() > Date.now(), 'Expiry must be in the future'),
  /** Optional ISO date (yyyy-mm-dd); '' = no review scheduled. Past dates
   *  are allowed — that's exactly how a review becomes overdue. */
  reviewDueAt: z
    .string()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date'),
});

type EditPatientValues = z.infer<typeof editPatientSchema>;

/**
 * Small dialog to edit a patient's name, optional date of birth, and photo
 * consent. Emptying the date of birth field saves null (date not recorded).
 * Selecting a scope records consent as of now (or keeps the original date if
 * the scope is unchanged); clearing the scope removes consent.
 */
function EditPatientDialog({
  patient,
  open,
  onOpenChange,
  onSaved,
}: {
  patient: Patient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (patient: Patient) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const form = useForm<EditPatientValues>({
    resolver: zodResolver(editPatientSchema),
    defaultValues: {
      name: patient.name,
      dateOfBirth: patient.dateOfBirth ? format(patient.dateOfBirth, 'dd/MM/yyyy') : '',
      consentScope: patient.consentScope ?? '',
      consentExpiresAt: patient.consentExpiresAt ? format(patient.consentExpiresAt, 'yyyy-MM-dd') : '',
      reviewDueAt: patient.reviewDueAt ? format(patient.reviewDueAt, 'yyyy-MM-dd') : '',
    },
  });

  const handleSubmit = async (values: EditPatientValues) => {
    setIsSaving(true);
    try {
      // Renaming onto another patient's exact name fragments records — the
      // service only warns, so confirm here where the user can still stop.
      if (
        values.name.trim().toLowerCase() !== patient.normalizedName &&
        (await patientService.isDuplicateName(values.name, patient.id)) &&
        !window.confirm(
          `Another patient is already named “${values.name.trim()}”.\n\nSave this patient with the same name anyway?`,
        )
      ) {
        return;
      }
      const scope = (values.consentScope || null) as ConsentScope | null;
      const expiresAt = values.consentExpiresAt
        ? new Date(`${values.consentExpiresAt}T00:00:00`)
        : null;
      // Keep the original consent date when the scope is untouched; a new
      // scope (or re-selecting after expiry) counts as freshly given.
      const keepDate = scope !== null && scope === patient.consentScope && consentStatus(patient) === 'valid';
      const updated = await patientService.updatePatient(patient.id, {
        name: values.name,
        dateOfBirth: parseDobInput(values.dateOfBirth),
        consent: {
          givenAt: scope ? (keepDate ? patient.consentGivenAt : new Date()) : null,
          scope,
          expiresAt: scope ? expiresAt : null,
        },
        review: {
          dueAt: values.reviewDueAt ? new Date(`${values.reviewDueAt}T00:00:00`) : null,
        },
      });
      notifyAttentionChanged();
      toast.success('Patient details updated');
      onSaved(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Failed to update patient: ${error.message}`
          : 'Failed to update patient. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit patient details</DialogTitle>
          <DialogDescription>
            Update the patient name, date of birth, consent, or review schedule.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Patient name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isSaving} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of birth</FormLabel>
                  <FormControl>
                    <DobInput
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      disabled={isSaving}
                    />
                  </FormControl>
                  <FormDescription>
                    Optional — type it (e.g. 4/2/85) or use the calendar. Leave blank for none.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consentScope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Photo consent</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isSaving}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a consent scope" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">No consent on record</SelectItem>
                      <SelectItem value="care">{ConsentScopeLabels.care}</SelectItem>
                      <SelectItem value="education">{ConsentScopeLabels.education}</SelectItem>
                      <SelectItem value="research">{ConsentScopeLabels.research}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Saving a scope records consent as of today. Changing or clearing it is
                    written to the audit log.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consentExpiresAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Consent expiry (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ''} disabled={isSaving || !form.watch('consentScope')} />
                  </FormControl>
                  <FormDescription>
                    After this date the patient shows as consent-expired. Leave blank for no expiry.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reviewDueAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next review date (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ''} disabled={isSaving} />
                  </FormControl>
                  <FormDescription>
                    The dashboard flags upcoming reviews ahead of time and overdue ones after.
                    Leave blank for none.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
