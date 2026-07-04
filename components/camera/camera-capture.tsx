/**
 * CameraCapture Component
 *
 * Main camera interface with video preview, capture button, and permission handling.
 * Integrates with useCamera hook for state management.
 */

'use client';

import { useRef, useEffect, useState } from 'react';
import { Aperture, SwitchCamera, Loader2 } from 'lucide-react';
import { useCamera } from '@/lib/hooks/use-camera';
import type { CapturedPhoto, CameraFacingMode } from '@/specs/001-role-you-are/contracts/camera-service';
import { cameraService } from '@/lib/services/camera-service';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface CameraCaptureProps {
  onPhotoCaptured: (photo: CapturedPhoto) => void;
  initialFacingMode?: CameraFacingMode;
}

export function CameraCapture({
  onPhotoCaptured,
  initialFacingMode = 'environment',
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, error, permission, isLoading, start, stop, switchCamera } = useCamera();
  const [currentFacingMode, setCurrentFacingMode] = useState<CameraFacingMode>(initialFacingMode);
  const [isCapturing, setIsCapturing] = useState(false);

  /**
   * Start camera on mount
   */
  useEffect(() => {
    start(initialFacingMode);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Attach stream to video element when available
   */
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  /**
   * Handle photo capture
   */
  const handleCapture = async () => {
    if (!videoRef.current || !stream) {
      return;
    }

    setIsCapturing(true);

    try {
      const photo = await cameraService.capturePhoto(videoRef.current);
      onPhotoCaptured(photo);
    } catch (error) {
      console.error('Failed to capture photo:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  /**
   * Handle camera switch (front/rear)
   */
  const handleSwitchCamera = async () => {
    const newFacingMode: CameraFacingMode =
      currentFacingMode === 'environment' ? 'user' : 'environment';

    try {
      await switchCamera(newFacingMode);
      setCurrentFacingMode(newFacingMode);
    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  };

  /**
   * Render permission denied state
   */
  if (permission === 'denied' || (error && error.name === 'PermissionDeniedError')) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold text-destructive">Camera Permission Denied</h3>
          <p className="text-sm text-muted-foreground">
            Please enable camera access in your browser settings to capture photos.
          </p>
          <div className="bg-muted p-4 rounded-md text-left text-sm space-y-2">
            <p className="font-medium">Instructions:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Click the lock icon in your browser&apos;s address bar</li>
              <li>Find &quot;Camera&quot; in the permissions list</li>
              <li>Change setting to &quot;Allow&quot;</li>
              <li>Reload this page</li>
            </ol>
          </div>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </Card>
    );
  }

  /**
   * Render not supported state
   */
  if (error && error.name === 'NotSupportedError') {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold text-destructive">Camera Not Available</h3>
          <p className="text-sm text-muted-foreground">
            Your device or browser does not support camera access.
          </p>
          <p className="text-xs text-muted-foreground">
            Please use a modern browser (Chrome 90+, Safari 14+, Firefox 88+, Edge 90+) on a device
            with a camera.
          </p>
        </div>
      </Card>
    );
  }

  /**
   * Render loading state
   */
  if (isLoading && !stream) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold">Initializing Camera...</h3>
          <div className="flex justify-center">
            <Loader2 className="size-12 animate-spin text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Please allow camera access when prompted
          </p>
        </div>
      </Card>
    );
  }

  /**
   * Render camera interface
   */
  return (
    <Card className="overflow-hidden">
      {/* Video Preview */}
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          aria-label="Camera preview"
        />

        {/* Camera switching is possible (mobile devices) */}
        {stream && (
          <Button
            onClick={handleSwitchCamera}
            variant="secondary"
            size="sm"
            className="absolute top-4 right-4"
            aria-label="Switch camera"
          >
            <SwitchCamera className="size-5" />
          </Button>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 flex justify-center gap-4">
        <Button
          onClick={handleCapture}
          disabled={!stream || isCapturing}
          size="lg"
          className="min-w-32"
        >
          {isCapturing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Capturing...
            </>
          ) : (
            <>
              <Aperture className="size-5" />
              Capture Photo
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
