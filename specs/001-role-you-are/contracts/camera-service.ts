/**
 * Camera Service Contract
 *
 * Defines the interface for camera access and photo capture operations.
 * Wraps browser MediaDevices API with error handling and state management.
 */

export type CameraFacingMode = 'user' | 'environment';
export type CameraPermissionState = 'granted' | 'denied' | 'prompt';

export interface CameraCapabilities {
  facingMode: CameraFacingMode[];
  resolution: {
    width: { min: number; max: number; ideal: number };
    height: { min: number; max: number; ideal: number };
  };
  zoom: {
    min: number;
    max: number;
    step: number;
  } | null;
}

export interface CapturedPhoto {
  blob: Blob;              // Raw image as JPEG Blob
  dataUrl: string;         // Base64 data URL for preview
  width: number;           // Original width in pixels
  height: number;          // Original height in pixels
  capturedAt: Date;        // Timestamp of capture
}

export interface ICameraService {
  /**
   * Checks if MediaDevices API is supported in current browser
   *
   * @returns true if getUserMedia is available, false otherwise
   */
  isSupported(): boolean;

  /**
   * Checks current camera permission state
   *
   * @returns Promise resolving to permission state
   * @throws Error if Permissions API is not supported
   *
   * Note: Some browsers (Safari) don't support Permissions API - returns 'prompt'
   */
  checkPermission(): Promise<CameraPermissionState>;

  /**
   * Requests camera access and returns video stream
   *
   * @param facingMode - Preferred camera ('user' for front, 'environment' for rear)
   * @param constraints - Optional custom MediaStreamConstraints
   * @returns Promise resolving to MediaStream
   * @throws PermissionDeniedError if user denies camera access
   * @throws NotSupportedError if camera not available
   * @throws Error if getUserMedia fails
   *
   * Side effects:
   * - Browser shows permission prompt if not previously granted
   * - Activates device camera (LED indicator turns on)
   */
  startCamera(
    facingMode?: CameraFacingMode,
    constraints?: MediaStreamConstraints
  ): Promise<MediaStream>;

  /**
   * Stops the active camera stream and releases hardware
   *
   * @param stream - MediaStream to stop
   * @returns void
   *
   * Side effects:
   * - Deactivates device camera (LED indicator turns off)
   * - Frees camera for use by other apps
   *
   * Note: Always call this when camera preview is unmounted (cleanup)
   */
  stopCamera(stream: MediaStream): void;

  /**
   * Switches between front and rear cameras (mobile devices)
   *
   * @param currentStream - Current active MediaStream
   * @param newFacingMode - Desired camera facing mode
   * @returns Promise resolving to new MediaStream
   * @throws Error if device doesn't have requested camera
   *
   * Side effects:
   * - Stops current stream
   * - Starts new stream with different camera
   */
  switchCamera(
    currentStream: MediaStream,
    newFacingMode: CameraFacingMode
  ): Promise<MediaStream>;

  /**
   * Captures a still photo from the active video stream
   *
   * @param videoElement - HTMLVideoElement showing camera preview
   * @param options.quality - JPEG quality 0.0-1.0 (default: 0.92)
   * @param options.mimeType - Output format (default: 'image/jpeg')
   * @returns Promise resolving to CapturedPhoto object
   * @throws Error if video element is not ready or capture fails
   *
   * Process:
   * 1. Creates offscreen canvas matching video dimensions
   * 2. Draws current video frame to canvas
   * 3. Converts canvas to Blob with specified quality
   * 4. Generates data URL for preview
   */
  capturePhoto(
    videoElement: HTMLVideoElement,
    options?: { quality?: number; mimeType?: string }
  ): Promise<CapturedPhoto>;

  /**
   * Gets camera capabilities (resolution, zoom, etc.)
   *
   * @param stream - Active MediaStream
   * @returns CameraCapabilities object
   * @throws Error if stream has no video track
   *
   * Note: Used to show resolution info or zoom controls to user
   */
  getCapabilities(stream: MediaStream): CameraCapabilities;

  /**
   * Applies zoom to the camera stream (if supported)
   *
   * @param stream - Active MediaStream
   * @param zoomLevel - Zoom value (must be within capabilities.zoom range)
   * @returns Promise resolving to void
   * @throws NotSupportedError if zoom not available
   * @throws RangeError if zoomLevel outside valid range
   */
  setZoom(stream: MediaStream, zoomLevel: number): Promise<void>;

  /**
   * Compresses and resizes photo to target dimensions
   *
   * @param blob - Original photo Blob
   * @param maxDimension - Maximum width/height in pixels (default: 1920)
   * @param quality - JPEG quality 0.0-1.0 (default: 0.85)
   * @returns Promise resolving to compressed Blob
   * @throws Error if image processing fails
   *
   * Process:
   * 1. Loads blob into Image element
   * 2. Calculates new dimensions (maintaining aspect ratio)
   * 3. Draws to canvas at new size
   * 4. Converts to Blob with quality compression
   *
   * Performance: ~200-500ms for 5MB photo on modern devices
   */
  compressPhoto(blob: Blob, maxDimension?: number, quality?: number): Promise<Blob>;

  /**
   * Generates thumbnail from photo blob
   *
   * @param blob - Original photo Blob
   * @param size - Thumbnail dimensions (default: 200x200)
   * @returns Promise resolving to thumbnail Blob
   * @throws Error if image processing fails
   *
   * Note: Maintains aspect ratio, crops to square from center
   */
  generateThumbnail(blob: Blob, size?: number): Promise<Blob>;
}

/**
 * Error Types
 */

export class PermissionDeniedError extends Error {
  constructor(message: string = 'Camera permission denied by user') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class NotSupportedError extends Error {
  constructor(message: string = 'Camera not supported on this device') {
    super(message);
    this.name = 'NotSupportedError';
  }
}
