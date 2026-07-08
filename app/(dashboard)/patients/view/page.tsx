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
import { ArrowLeft, AlertCircle, Camera, Globe, Lock } from 'lucide-react';
import Link from 'next/link';
import type { Patient } from '@/types/patient';
import type { PhotoRecord } from '@/types/photo';
import { PhotoTimeline } from '@/components/photo/photo-timeline';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { usePhotos } from '@/lib/hooks/use-photos';
import { patientService } from '@/lib/services/patient-service';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function PatientTimelineView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
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
          action={<Button onClick={handleBackClick}>Back to Patients</Button>}
        />
      </div>
    );
  }

  if (!patient) return null;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <Button variant="ghost" onClick={handleBackClick} className="mb-4 -ml-2">
        <ArrowLeft className="size-4" />
        Back to Patients
      </Button>

      <PageHeader
        title={patient.name}
        description={
          <>
            {patient.photoCount} {patient.photoCount === 1 ? 'photo' : 'photos'}
            {patient.ownerName && <> · Owner: {patient.ownerName}</>}
            {' · '}
            <Link
              href={`/capture?patient=${encodeURIComponent(patient.name)}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Add another
            </Link>
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
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
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
