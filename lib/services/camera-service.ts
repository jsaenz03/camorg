/**
 * Camera Service Implementation
 *
 * Wraps browser MediaDevices API with error handling and state management.
 * Implements ICameraService interface from contracts/camera-service.ts
 */

import type {
  CameraFacingMode,
  CameraPermissionState,
  CameraCapabilities,
  CapturedPhoto,
  ICameraService,
} from '@/specs/001-role-you-are/contracts/camera-service';
import { PermissionDeniedError, NotSupportedError } from '@/lib/validators/errors';

export class CameraService implements ICameraService {
  /**
   * Checks if MediaDevices API is supported in current browser
   */
  isSupported(): boolean {
    return !!(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  /**
   * Checks current camera permission state
   */
  async checkPermission(): Promise<CameraPermissionState> {
    // Check if Permissions API is available
    if (!navigator.permissions) {
      // Safari doesn't support Permissions API, return 'prompt'
      return 'prompt';
    }

    try {
      const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      return permission.state as CameraPermissionState;
    } catch (error) {
      // Permissions API not supported or query failed
      return 'prompt';
    }
  }

  /**
   * Requests camera access and returns video stream
   */
  async startCamera(
    facingMode: CameraFacingMode = 'environment',
    constraints?: MediaStreamConstraints
  ): Promise<MediaStream> {
    if (!this.isSupported()) {
      throw new NotSupportedError('Camera not supported on this device');
    }

    const defaultConstraints: MediaStreamConstraints = {
      video: {
        facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    const finalConstraints = constraints || defaultConstraints;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      return stream;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          throw new PermissionDeniedError('Camera permission denied by user');
        }
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          throw new NotSupportedError('No camera device found');
        }
        if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          throw new Error('Camera is already in use by another application');
        }
      }
      throw error;
    }
  }

  /**
   * Stops the active camera stream and releases hardware
   */
  stopCamera(stream: MediaStream): void {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }

  /**
   * Switches between front and rear cameras
   */
  async switchCamera(
    currentStream: MediaStream,
    newFacingMode: CameraFacingMode
  ): Promise<MediaStream> {
    this.stopCamera(currentStream);
    return this.startCamera(newFacingMode);
  }

  /**
   * Captures a still photo from the active video stream
   */
  async capturePhoto(
    videoElement: HTMLVideoElement,
    options: { quality?: number; mimeType?: string } = {}
  ): Promise<CapturedPhoto> {
    const { quality = 0.92, mimeType = 'image/jpeg' } = options;

    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      throw new Error('Video element is not ready');
    }

    // Create offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    // Draw current video frame to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    // Convert canvas to Blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to capture photo'));
          }
        },
        mimeType,
        quality
      );
    });

    // Generate data URL for preview
    const dataUrl = canvas.toDataURL(mimeType, quality);

    return {
      blob,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      capturedAt: new Date(),
    };
  }

  /**
   * Gets camera capabilities
   */
  getCapabilities(stream: MediaStream): CameraCapabilities {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('No video track found in stream');
    }

    const capabilities = videoTrack.getCapabilities();

    return {
      facingMode: (capabilities.facingMode as CameraFacingMode[]) || ['environment'],
      resolution: {
        width: {
          min: capabilities.width?.min || 640,
          max: capabilities.width?.max || 1920,
          ideal: 1920,
        },
        height: {
          min: capabilities.height?.min || 480,
          max: capabilities.height?.max || 1080,
          ideal: 1080,
        },
      },
      zoom: capabilities.zoom
        ? {
            min: capabilities.zoom.min,
            max: capabilities.zoom.max,
            step: capabilities.zoom.step || 0.1,
          }
        : null,
    };
  }

  /**
   * Applies zoom to the camera stream
   */
  async setZoom(stream: MediaStream, zoomLevel: number): Promise<void> {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('No video track found in stream');
    }

    const capabilities = videoTrack.getCapabilities();
    if (!capabilities.zoom) {
      throw new NotSupportedError('Zoom not supported on this device');
    }

    if (zoomLevel < capabilities.zoom.min || zoomLevel > capabilities.zoom.max) {
      throw new RangeError(
        `Zoom level ${zoomLevel} is outside valid range [${capabilities.zoom.min}, ${capabilities.zoom.max}]`
      );
    }

    await videoTrack.applyConstraints({
      advanced: [{ zoom: zoomLevel } as any],
    });
  }

  /**
   * Compresses and resizes photo to target dimensions
   */
  async compressPhoto(
    blob: Blob,
    maxDimension: number = 1920,
    quality: number = 0.85
  ): Promise<Blob> {
    // Load blob into Image element
    const img = await this.loadImage(blob);

    // Calculate new dimensions (maintaining aspect ratio)
    let { width, height } = img;
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    // Draw to canvas at new size
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    ctx.drawImage(img, 0, 0, width, height);

    // Convert to Blob with quality compression
    const compressedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress photo'));
          }
        },
        'image/jpeg',
        quality
      );
    });

    return compressedBlob;
  }

  /**
   * Generates thumbnail from photo blob
   */
  async generateThumbnail(blob: Blob, size: number = 200): Promise<Blob> {
    const img = await this.loadImage(blob);

    // Create square canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Calculate crop dimensions to maintain aspect ratio
    const { width, height } = img;
    const aspectRatio = width / height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = width;
    let sourceHeight = height;

    if (aspectRatio > 1) {
      // Landscape: crop width
      sourceWidth = height;
      sourceX = (width - height) / 2;
    } else {
      // Portrait: crop height
      sourceHeight = width;
      sourceY = (height - width) / 2;
    }

    // Draw cropped and scaled image
    ctx.drawImage(
      img,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      size,
      size
    );

    // Convert to Blob
    const thumbnailBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to generate thumbnail'));
          }
        },
        'image/jpeg',
        0.8
      );
    });

    return thumbnailBlob;
  }

  /**
   * Helper: Load blob into Image element
   */
  private loadImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }
}

// Export singleton instance
export const cameraService = new CameraService();
