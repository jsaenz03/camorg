/**
 * Camera failure copy — one voice for every way a camera can fail to open.
 * The capture dialog's error states show what went wrong ("no camera
 * available") instead of a blank preview or a page reload, with the real
 * actions a clinician has: try again, use the phone, or upload a file.
 */

export interface CameraFailure {
  title: string;
  message: string;
}

export function cameraFailure(
  error: { name?: string; message: string } | null | undefined,
  permission: string,
): CameraFailure {
  if (error?.name === 'PermissionDeniedError' || permission === 'denied') {
    return {
      title: 'Camera access denied',
      message: 'Camog needs camera access from your system before the preview can start.',
    };
  }
  if (error?.name === 'NotSupportedError') {
    return {
      title: 'No camera available',
      message:
        'No usable camera was found on this device. Connect one, or use your phone or a file below.',
    };
  }
  if (error && /already in use|in use by another/i.test(error.message)) {
    return {
      title: 'Camera is in use',
      message:
        'Another application is using the camera (for example Teams or Zoom). Close it and try again.',
    };
  }
  return {
    title: 'Camera problem',
    message:
      error?.message?.trim() || 'Something went wrong starting the camera. Try again, or use your phone or a file below.',
  };
}
