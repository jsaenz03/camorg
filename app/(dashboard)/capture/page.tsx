/**
 * Photo Capture Page
 *
 * Main page for capturing clinical photos with metadata.
 * Composes CameraCapture + PhotoMetadataForm + save logic.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '@/components/camera/camera-capture';
import { PhotoMetadataForm, type PhotoMetadataFormValues } from '@/components/photo/photo-metadata-form';
import type { CapturedPhoto } from '@/specs/001-role-you-are/contracts/camera-service';
import { photoService } from '@/lib/services/photo-service';
import { patientService } from '@/lib/services/patient-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function CapturePage() {
  const router = useRouter();
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
        // Use existing patient
        patientId = exactMatch.id;
      } else {
        // Create new patient
        const newPatient = await patientService.createPatient({
          name: formData.patientName,
        });
        patientId = newPatient.id;
        toast.info(`Created new patient: ${formData.patientName}`);
      }

      // 2. Create photo record
      const photoRecord = await photoService.createPhoto({
        patientId,
        imageBlob: capturedPhoto.blob,
        mimeType: capturedPhoto.blob.type as 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp',
        bodyPart: formData.bodyPart,
        subpart: formData.subpart || null,
        clinicalNotes: formData.clinicalNotes || null,
        capturedAt: capturedPhoto.capturedAt,
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
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Capture Photo</h1>
          <p className="text-muted-foreground mt-2">
            Capture a clinical photograph and add patient metadata
          </p>
        </div>

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
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mx-auto mb-4 opacity-50"
                    >
                      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                      <circle cx="12" cy="13" r="3" />
                    </svg>
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
