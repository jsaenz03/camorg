/**
 * CameraCapture Component
 *
 * The capture sources in one card: the phone (QR pairing, the default
 * landing), the built-in camera, and — when neither is available — a photo
 * picked from disk, which enters the same review form as a capture. Failure
 * states name the actual problem (no camera / access denied / camera busy)
 * and offer all three ways forward instead of reloading the page.
 */

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Aperture, Camera, Loader2, Smartphone, SwitchCamera, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { useCamera } from '@/lib/hooks/use-camera';
import type { CapturedPhoto, CameraFacingMode } from '@/specs/001-role-you-are/contracts/camera-service';
import { cameraService } from '@/lib/services/camera-service';
import { PhoneCameraPanel } from '@/components/camera/phone-camera-panel';
import { cameraFailure } from '@/lib/photo/camera-failure';
import { UPLOAD_MIME_TYPES, uploadRejection, fileToCapturedPhoto } from '@/lib/photo/captured-file';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Persisted camera choice (deviceId). Empty/unset means "default (auto)".
const CAMERA_DEVICE_PREF = 'camog:camera-device-id';

function constraintsFor(deviceId: string): MediaStreamConstraints | undefined {
  if (!deviceId) {
    return undefined;
  }
  return {
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  };
}

interface CameraCaptureProps {
  onPhotoCaptured: (photo: CapturedPhoto) => void;
  initialFacingMode?: CameraFacingMode;
}

export function CameraCapture({
  onPhotoCaptured,
  initialFacingMode = 'environment',
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { stream, error, permission, isLoading, start, stop, switchCamera } = useCamera();
  const [currentFacingMode, setCurrentFacingMode] = useState<CameraFacingMode>(initialFacingMode);
  const [isCapturing, setIsCapturing] = useState(false);
  // Phone QR is the default landing — the built-in camera spins up only on an
  // explicit switch (an always-on camera on every visit gets annoying fast).
  const [phoneMode, setPhoneMode] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  /**
   * Restore a previously chosen camera (e.g. a phone tethered as a USB
   * webcam) for when the built-in flow is opened; the camera itself starts
   * only via "Use built-in camera".
   */
  useEffect(() => {
    setDeviceId(window.localStorage.getItem(CAMERA_DEVICE_PREF) ?? '');
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * List cameras once permission is granted (labels need it), and refresh
   * when devices are plugged/unplugged (e.g. tethering a phone by USB).
   */
  const refreshCameras = useCallback(async () => {
    try {
      setCameras(await cameraService.listCameras());
    } catch {
      // enumerateDevices unavailable — picker just stays hidden
    }
  }, []);

  useEffect(() => {
    if (!stream) {
      return;
    }
    void refreshCameras();
    navigator.mediaDevices.addEventListener('devicechange', refreshCameras);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshCameras);
  }, [stream, refreshCameras]);

  /**
   * Handle explicit camera selection; falls back to the default camera if
   * the chosen device can no longer be opened.
   */
  const handleCameraChange = async (value: string) => {
    const nextDeviceId = value === 'default' ? '' : value;
    setDeviceId(nextDeviceId);
    window.localStorage.setItem(CAMERA_DEVICE_PREF, nextDeviceId);
    stop();
    try {
      await start(currentFacingMode, constraintsFor(nextDeviceId));
    } catch (error) {
      console.error('Failed to open selected camera:', error);
      toast.error('Could not open that camera. Falling back to the default camera.');
      setDeviceId('');
      window.localStorage.removeItem(CAMERA_DEVICE_PREF);
      await start(currentFacingMode);
    }
  };

  /**
   * Attach stream to video element when available
   */
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      // WKWebView sometimes needs an explicit play() nudge despite autoPlay.
      void videoRef.current.play().catch(() => {});
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
      toast.error(
        error instanceof Error && error.message
          ? `Could not capture photo: ${error.message}`
          : 'Could not capture photo. Please try again.'
      );
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
      toast.error('Could not switch camera.');
    }
  };

  /**
   * Switch capture to a tethered phone: release the built-in camera and let
   * PhoneCameraPanel own the capture until switched back or unmounted.
   */
  const handleUsePhoneCamera = () => {
    stop();
    setPhoneMode(true);
  };

  const handleUseBuiltInCamera = () => {
    setPhoneMode(false);
    start(currentFacingMode, constraintsFor(deviceId));
  };

  /**
   * Retry the built-in camera in place — never a page reload, which would
   * tear down the whole capture (and any half-entered metadata).
   */
  const restartCamera = () => {
    start(currentFacingMode, constraintsFor(deviceId));
  };

  /**
   * A file picked from disk enters the same review form as a capture — the
   * fallback when no camera (built-in or phone) is available.
   */
  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    const file = files[0];
    if (!file) return;
    const reject = uploadRejection(file);
    if (reject) {
      toast.error(
        reject === 'mime'
          ? `${file.name}: use a JPEG, PNG or WebP file.`
          : `${file.name}: over the 20MB limit.`
      );
      return;
    }
    setIsUploading(true);
    try {
      onPhotoCaptured(await fileToCapturedPhoto(file));
    } catch (err) {
      console.error('Failed to read picked file:', err);
      toast.error(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setIsUploading(false);
    }
  };

  const openUploadPicker = () => uploadInputRef.current?.click();

  // The hidden picker is shared by the phone panel and every failure state;
  // only one of those branches renders at a time.
  const uploadPicker = (
    <input
      ref={uploadInputRef}
      type="file"
      accept={UPLOAD_MIME_TYPES.join(',')}
      onChange={(event) => void handleUploadChange(event)}
      hidden
    />
  );

  const uploadButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={openUploadPicker}
      disabled={isUploading}
    >
      {isUploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
      {isUploading ? 'Reading file…' : 'Upload from computer'}
    </Button>
  );

  /**
   * Render phone-camera pairing (takes precedence over local camera states)
   */
  if (phoneMode) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Phone camera</h3>
            <div className="flex items-center gap-1">
              {uploadButton}
              <Button variant="ghost" size="sm" onClick={handleUseBuiltInCamera}>
                <Camera className="size-4" />
                Use built-in camera
              </Button>
            </div>
          </div>
          <PhoneCameraPanel />
        </div>
        {uploadPicker}
      </Card>
    );
  }

  /**
   * Render loading state — a wedged camera can hang here indefinitely, so
   * the other sources stay reachable while it tries.
   */
  if (isLoading && !stream) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold">Starting camera…</h3>
          <div className="flex justify-center">
            <Loader2 className="size-12 animate-spin text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Allow camera access if your system asks
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={handleUsePhoneCamera}>
              <Smartphone className="size-4" />
              Use phone camera
            </Button>
            {uploadButton}
          </div>
        </div>
        {uploadPicker}
      </Card>
    );
  }

  const failure = cameraFailure(error, permission);
  const accessDenied =
    error?.name === 'PermissionDeniedError' || permission === 'denied';

  /**
   * Render failure state — any way the camera won't open names the real
   * problem and keeps all three ways forward (reload for a system-denied
   * camera, phone, file). The camera is retried in place; a reload tears
   * down the whole capture, so the only reload we offer is the one system
   * permissions actually require.
   */
  if (!stream && (error || accessDenied)) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold text-destructive">{failure.title}</h3>
          <p className="text-sm text-muted-foreground">{failure.message}</p>
          {accessDenied && (
            <div className="bg-muted p-4 rounded-md text-left text-sm space-y-2">
              <p className="font-medium">To enable it:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Open your system privacy settings (Windows: Settings → Privacy &amp; security → Camera; macOS: System Settings → Privacy &amp; Security → Camera)</li>
                <li>Allow camera access for Camog</li>
                <li>Come back here and reload Camog</li>
              </ol>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {accessDenied ? (
              <Button variant="outline" onClick={() => window.location.reload()}>Reload Camog</Button>
            ) : (
              <Button variant="outline" onClick={restartCamera}>Try again</Button>
            )}
            <Button variant="secondary" onClick={handleUsePhoneCamera}>
              <Smartphone className="size-4" />
              Use phone camera
            </Button>
            {uploadButton}
          </div>
        </div>
        {uploadPicker}
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

      {/* Camera picker — appears once there is a real choice (e.g. a phone
          tethered as a USB webcam shows up here) or a saved selection */}
      {(cameras.length > 1 || deviceId) && (
        <div className="px-4 pt-4 flex items-center gap-3">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Camera</span>
          <Select
            value={deviceId || 'default'}
            onValueChange={handleCameraChange}
            disabled={!stream || isCapturing}
          >
            <SelectTrigger className="w-full" aria-label="Camera device">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default (auto)</SelectItem>
              {cameras.map((camera, index) => (
                <SelectItem
                  key={camera.deviceId || `camera-${index}`}
                  value={camera.deviceId || `camera-${index}`}
                >
                  {camera.label || `Camera ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
              Capturing…
            </>
          ) : (
            <>
              <Aperture className="size-5" />
              Capture photo
            </>
          )}
        </Button>
        <Button
          onClick={handleUsePhoneCamera}
          variant="outline"
          size="lg"
          className="min-w-32"
        >
          <Smartphone className="size-5" />
          Use phone camera
        </Button>
      </div>
    </Card>
  );
}
