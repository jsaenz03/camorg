/**
 * Photo Capture Page
 *
 * Main page for capturing clinical photos with metadata.
 * Composes CameraCapture + PhotoMetadataForm + save logic.
 *
 * Reads ?patient= to prefill the patient name (linked from home/timeline).
 * useSearchParams forces a Suspense boundary for static export.
 */

'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Camera } from 'lucide-react';
import { CameraCapture } from '@/components/camera/camera-capture';
import { PhotoMetadataForm, type PhotoMetadataFormValues } from '@/components/photo/photo-metadata-form';
import { PageHeader } from '@/components/page-header';
import type { CapturedPhoto } from '@/specs/001-role-you-are/contracts/camera-service';
import { photoService } from '@/lib/services/photo-service';
import { patientService } from '@/lib/services/patient-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function CaptureView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const patientHint = searchParams.get('patient') ?? '';
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handle photo capture from camera
   */
  const handlePhotoCaptured = (photo: CapturedPhoto) => {
    setCapturedPhoto(photo);
    toast.success('Photo captured successfully');
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
      // 1. Find or create patient
      const patients = await patientService.searchPatients(formData.patientName);
      const exactMatch = patients.find(
        (p) => p.normalizedName === formData.patientName.trim().toLowerCase()
      );

      let patientId: string;

      if (exactMatch) {
        patientId = exactMatch.id;
      } else {
        const newPatient = await patientService.createPatient({
          name: formData.patientName,
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
        subpart: formData.subpart || null,
        clinicalNotes: formData.clinicalNotes || null,
        capturedAt: formData.capturedAt ?? capturedPhoto.capturedAt,
      });

      toast.success('Photo saved successfully');

      // 3. Navigate to patient timeline
      router.push(`/patients/view?id=${patientId}`);
    } catch (error) {
      console.error('Failed to save photo:', error);

      if (error instanceof Error) {
        if (error.name === 'StorageQuotaError') {
          toast.error('Storage quota exceeded. Please delete old photos or clear browser data.');
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
   * Handle cancel - discard captured photo and start over
   */
  const handleCancel = () => {
    setCapturedPhoto(null);
    toast.info('Photo discarded');
  };

  /**
   * Handle retake - discard captured photo and show camera again
   */
  const handleRetake = () => {
    setCapturedPhoto(null);
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-10">
      <div className="space-y-6">
        <PageHeader
          title="Capture Photo"
          description="Capture a clinical photograph and add patient metadata."
        />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Camera or Captured Photo */}
          <div>
            {!capturedPhoto ? (
              <CameraCapture onPhotoCaptured={handlePhotoCaptured} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Captured Photo</CardTitle>
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
                      Retake Photo
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
                <CardTitle>Photo Metadata</CardTitle>
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
                    defaultValues={patientHint ? { patientName: patientHint } : undefined}
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
    </div>
  );
}

export default function CapturePage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-10">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      }
    >
      <CaptureView />
    </Suspense>
  );
}
