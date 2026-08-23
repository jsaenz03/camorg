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
import { ArrowLeft, AlertCircle, CalendarIcon, Camera, Globe, Loader2, Lock, Pencil } from 'lucide-react';
import Link from 'next/link';
import type { Patient } from '@/types/patient';
import type { PhotoRecord } from '@/types/photo';
import { PhotoTimeline } from '@/components/photo/photo-timeline';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { usePhotos } from '@/lib/hooks/use-photos';
import { patientService } from '@/lib/services/patient-service';
import { formatDateOfBirth } from '@/lib/utils/date-formatting';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function PatientTimelineView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState<PhotoRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { photos, isLoading: isLoadingPhotos, error, refresh } = usePhotos({
    patientId,
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
    .date()
    .nullable()
    .refine((d) => !d || d.getTime() <= Date.now(), 'Date of birth cannot be in the future'),
});

type EditPatientValues = z.infer<typeof editPatientSchema>;

/**
 * Small dialog to edit a patient's name and optional date of birth.
 * Clearing the DOB picker saves null (date not recorded).
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
      dateOfBirth: patient.dateOfBirth,
    },
  });

  const handleSubmit = async (values: EditPatientValues) => {
    setIsSaving(true);
    try {
      const updated = await patientService.updatePatient(patient.id, {
        name: values.name,
        dateOfBirth: values.dateOfBirth,
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
                <FormItem className="flex flex-col">
                  <FormLabel>Date of birth</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          disabled={isSaving}
                          className={cn(
                            'w-full justify-between text-left font-normal',
                            !field.value && 'text-muted-foreground',
                          )}
                        >
                          {field.value ? format(field.value, 'd MMM yyyy') : 'Not recorded'}
                          <CalendarIcon className="size-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value ?? undefined}
                        onSelect={(d) => field.onChange(d ?? null)}
                        disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                      />
                      <div className="flex justify-end border-t p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => field.onChange(null)}
                        >
                          Clear
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
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
