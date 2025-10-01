import React, { useState } from 'react';
import { PhotoCapture } from '@/components/photo/PhotoCapture';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Camera } from 'lucide-react';

interface CameraTestPageProps {
  onBack?: () => void;
}

export function CameraTestPage({ onBack }: CameraTestPageProps) {
  const [capturedPhoto, setCapturedPhoto] = useState<Blob | null>(null);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);

  const handlePhotoCapture = (blob: Blob) => {
    setCapturedPhoto(blob);

    // Create object URL for preview
    if (capturedPhotoUrl) {
      URL.revokeObjectURL(capturedPhotoUrl);
    }

    const url = URL.createObjectURL(blob);
    setCapturedPhotoUrl(url);
  };

  const handleError = (error: string) => {
    console.error('Camera error:', error);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Camera Test</h1>
          <p className="text-muted-foreground">
            Test camera functionality for photo capture
          </p>
        </div>
      </div>

      {/* Camera Component */}
      <PhotoCapture
        onPhotoCapture={handlePhotoCapture}
        onError={handleError}
      />

      {/* Captured Photo Preview */}
      {capturedPhoto && capturedPhotoUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Captured Photo
            </CardTitle>
            <CardDescription>
              Photo size: {Math.round(capturedPhoto.size / 1024)} KB
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-md mx-auto">
              <img
                src={capturedPhotoUrl}
                alt="Captured photo"
                className="w-full rounded-lg border"
              />
            </div>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              This photo would normally be saved to the patient's album
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            1. Click "Start Camera" to access your device's camera
          </p>
          <p className="text-sm">
            2. Position the camera for your photo
          </p>
          <p className="text-sm">
            3. Click "Capture Photo" to take the picture
          </p>
          <p className="text-sm">
            4. Use "Retake" to capture again or "Download" to save the image
          </p>
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground">
              <strong>Note:</strong> This is a demo component. In the full application,
              captured photos would be automatically associated with a patient record
              and saved to the local database.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}