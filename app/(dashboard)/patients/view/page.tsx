/**
 * Patient Timeline Page
 *
 * Displays a chronological timeline of photos for a specific patient.
 * Supports body part filtering and photo selection for comparison.
 *
 * Static-export friendly: reads patient id from ?id= query param
 * (no dynamic [id] segment).
 */

'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useCallback, useEffect, Suspense } from 'react';
import type { Patient } from '@/types/patient';
import type { PhotoRecord } from '@/types/photo';
import { PhotoTimeline } from '@/components/photo/photo-timeline';
import { usePhotos } from '@/lib/hooks/use-photos';
import { patientService } from '@/lib/services/patient-service';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function PatientTimelineView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [isComparisonMode, setIsComparisonMode] = useState(false);

  const { photos, isLoading: isLoadingPhotos, error } = usePhotos({
    patientId,
  });

  // Load patient data
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

  const handlePhotoClick = useCallback(
    (photo: PhotoRecord) => {
      // If not in comparison mode, open photo detail view (to be implemented)
      if (!isComparisonMode) {
        // TODO: Navigate to photo detail view
        console.log('Open photo detail:', photo.id);
      }
    },
    [isComparisonMode]
  );

  const handleSelectionChange = useCallback((photoId: string, selected: boolean) => {
    setSelectedPhotoIds((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        if (newSet.size < 4) {
          newSet.add(photoId);
        } else {
          toast.error('Maximum 4 photos can be selected for comparison');
        }
      } else {
        newSet.delete(photoId);
      }
      return newSet;
    });
  }, []);

  const handleCompare = useCallback(() => {
    if (selectedPhotoIds.size < 2) {
      toast.error('Select at least 2 photos to compare');
      return;
    }
    if (selectedPhotoIds.size > 4) {
      toast.error('Maximum 4 photos can be selected for comparison');
      return;
    }

    const photoIdsArray = Array.from(selectedPhotoIds);
    // ponytail: compare route does not exist yet; link is a placeholder
    router.push(`/patients/compare?id=${patientId}&photos=${photoIdsArray.join(',')}`);
  }, [selectedPhotoIds, patientId, router]);

  const handleBackClick = useCallback(() => {
    router.push('/patients');
  }, [router]);

  const toggleComparisonMode = useCallback(() => {
    setIsComparisonMode((prev) => !prev);
    if (isComparisonMode) {
      setSelectedPhotoIds(new Set());
    }
  }, [isComparisonMode]);

  // Loading state
  if (isLoadingPatient || isLoadingPhotos) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-8" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-destructive"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Error loading timeline</h3>
          <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
          <Button onClick={handleBackClick}>Back to Patients</Button>
        </div>
      </div>
    );
  }

  if (!patient) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={handleBackClick}
          className="mb-4"
        >
          <svg
            className="w-4 h-4 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Patients
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{patient.name}</h1>
            <p className="text-muted-foreground">
              {patient.photoCount} {patient.photoCount === 1 ? 'photo' : 'photos'}
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant={isComparisonMode ? 'default' : 'outline'}
              onClick={toggleComparisonMode}
            >
              {isComparisonMode ? 'Cancel Selection' : 'Select Photos to Compare'}
            </Button>

            {isComparisonMode && selectedPhotoIds.size >= 2 && (
              <Button onClick={handleCompare}>
                Compare {selectedPhotoIds.size} Photos
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <PhotoTimeline
        photos={photos}
        onPhotoClick={handlePhotoClick}
        showFilter={true}
        showSelection={isComparisonMode}
        selectedPhotoIds={selectedPhotoIds}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  );
}

export default function PatientTimelinePage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-8" />
        <Skeleton className="h-96 w-full" />
      </div>
    }>
      <PatientTimelineView />
    </Suspense>
  );
}
