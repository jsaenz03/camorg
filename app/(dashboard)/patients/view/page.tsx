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
import { useState, useCallback, useEffect, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { ArrowLeft, AlertCircle, Camera, Globe, Loader2, Lock, Pencil } from 'lucide-react';
import Link from 'next/link';
import type { Patient } from '@/types/patient';
import type { PhotoRecord } from '@/types/photo';
import { PhotoTimeline } from '@/components/photo/photo-timeline';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { PhotoUpload } from '@/components/photo/photo-upload';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { usePhotos } from '@/lib/hooks/use-photos';
import { useAuth } from '@/lib/auth/auth-context';
import { patientService } from '@/lib/services/patient-service';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function PatientTimelineView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;
  const { clinician } = useAuth();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState<PhotoRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { photos, isLoading: isLoadingPhotos, error, refresh } = usePhotos({
    patientId,
    // The "Show deleted photos" preference reveals soft-deleted captures in
    // the timeline (badged, restorable from the detail dialog).
    includeDeleted: clinician?.preferences.showDeletedPhotos ?? false,
  });

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
            <Button variant="outline" onClick={() => setIsEditOpen(true)}>
              <Pencil className="size-4" />
              Edit details
            </Button>
            <PhotoUpload patient={patient} onSaved={handleUploadSaved} />
            <Button asChild>
              <Link href={`/capture?patient=${encodeURIComponent(patient.name)}`}>
                <Camera className="size-4" />
                Capture
              </Link>
            </Button>
          </div>
        }
      />

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
});

type EditPatientValues = z.infer<typeof editPatientSchema>;

/**
 * Small dialog to edit a patient's name and optional date of birth.
 * Emptying the date of birth field saves null (date not recorded).
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
    },
  });

  const handleSubmit = async (values: EditPatientValues) => {
    setIsSaving(true);
    try {
      const updated = await patientService.updatePatient(patient.id, {
        name: values.name,
        dateOfBirth: parseDobInput(values.dateOfBirth),
      });
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
            Update the patient name or record an optional date of birth.
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
