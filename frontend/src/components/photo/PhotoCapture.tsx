import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Square, RotateCcw, Download, SwitchCamera } from 'lucide-react';

interface PhotoCaptureProps {
  onPhotoCapture?: (imageBlob: Blob) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

type FacingMode = 'user' | 'environment';

export function PhotoCapture({ onPhotoCapture, onError, disabled = false }: PhotoCaptureProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment'); // Default to back camera for dermatology

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async (mode?: FacingMode) => {
    try {
      setError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera is not supported in this browser');
      }

      const cameraMode = mode || facingMode;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: cameraMode
        }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playError) {
          console.warn('Unable to start camera preview automatically', playError);
        }
      }

      setIsStreaming(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to access camera';
      setError(errorMessage);
      onError?.(errorMessage);
    }
  }, [onError, facingMode]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const videoElement = videoRef.current;
    const stream = streamRef.current;

    if (videoElement && stream) {
      videoElement.srcObject = stream;
      const playPromise = videoElement.play();
      if (playPromise) {
        playPromise.catch((err) => {
          console.warn('Unable to start camera preview automatically', err);
        });
      }
    }

    return () => {
      if (videoElement) {
        videoElement.srcObject = null;
      }
    };
  }, [isStreaming]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsStreaming(false);
  }, []);

  const switchCamera = useCallback(async () => {
    // Stop current camera
    stopCamera();

    // Switch facing mode
    const newFacingMode: FacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacingMode);

    // Start camera with new facing mode
    await startCamera(newFacingMode);
  }, [facingMode, stopCamera, startCamera]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !displayCanvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const displayCanvas = displayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const displayCtx = displayCanvas.getContext('2d');

    if (!ctx || !displayCtx) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    displayCanvas.width = video.videoWidth;
    displayCanvas.height = video.videoHeight;

    // Draw video frame to both canvases
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    displayCtx.drawImage(video, 0, 0, displayCanvas.width, displayCanvas.height);

    // Convert to blob
    canvas.toBlob((blob) => {
      if (blob) {
        setHasPhoto(true);
        onPhotoCapture?.(blob);
      }
    }, 'image/jpeg', 0.9);
  }, [onPhotoCapture]);

  const retakePhoto = useCallback(() => {
    setHasPhoto(false);
    if (displayCanvasRef.current) {
      const ctx = displayCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, displayCanvasRef.current.width, displayCanvasRef.current.height);
      }
    }
  }, []);

  const downloadPhoto = useCallback(() => {
    if (!canvasRef.current) return;

    canvasRef.current.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `photo-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }, 'image/jpeg', 0.9);
  }, []);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Photo Capture
        </CardTitle>
        <CardDescription>
          Capture photos directly from your camera for patient documentation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Camera View */}
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
          {isStreaming && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}

          {hasPhoto && (
            <canvas
              ref={displayCanvasRef}
              className="w-full h-full object-cover"
            />
          )}

          {!isStreaming && !hasPhoto && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {disabled ? 'Please select a body part first' : 'Camera preview will appear here'}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-destructive mb-4">{error}</p>
                <Button onClick={() => startCamera()} variant="outline">
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Canvas for photo capture (hidden) */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Controls */}
        <div className="flex justify-center gap-2">
          {!isStreaming && !hasPhoto && (
            <Button
              onClick={() => startCamera()}
              className="flex items-center gap-2"
              disabled={disabled}
            >
              <Camera className="h-4 w-4" />
              Start Camera
            </Button>
          )}

          {isStreaming && !hasPhoto && (
            <>
              <Button onClick={capturePhoto} className="flex items-center gap-2" size="lg">
                <Square className="h-5 w-5" />
                Capture Photo
              </Button>
              <Button onClick={switchCamera} variant="outline" className="flex items-center gap-2">
                <SwitchCamera className="h-4 w-4" />
                Flip Camera
              </Button>
              <Button onClick={stopCamera} variant="outline">
                Stop Camera
              </Button>
            </>
          )}

          {hasPhoto && (
            <>
              <Button onClick={retakePhoto} variant="outline" className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4" />
                Retake
              </Button>
              <Button onClick={downloadPhoto} className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Download
              </Button>
            </>
          )}
        </div>

        {/* Instructions */}
        <div className="text-sm text-muted-foreground text-center">
          {!isStreaming && !hasPhoto && (
            disabled ? 'Please select a body part to enable camera' : 'Click "Start Camera" to begin photo capture'
          )}
          {isStreaming && !hasPhoto && 'Position the camera and click "Capture Photo"'}
          {hasPhoto && 'Photo captured! You can retake or download the image'}
        </div>
      </CardContent>
    </Card>
  );
}