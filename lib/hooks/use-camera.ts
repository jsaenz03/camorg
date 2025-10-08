/**
 * useCamera Hook
 *
 * React hook for managing camera access, permissions, and lifecycle.
 * Wraps CameraService with React state management.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CameraFacingMode, CameraPermissionState } from '@/specs/001-role-you-are/contracts/camera-service';
import { cameraService } from '@/lib/services/camera-service';

interface UseCameraReturn {
  stream: MediaStream | null;
  error: Error | null;
  permission: CameraPermissionState;
  isLoading: boolean;
  start: (facingMode?: CameraFacingMode) => Promise<void>;
  stop: () => void;
  switchCamera: (newFacingMode: CameraFacingMode) => Promise<void>;
}

/**
 * Hook for managing camera access and state
 *
 * @example
 * ```tsx
 * const { stream, error, start, stop } = useCamera();
 *
 * useEffect(() => {
 *   start('environment');
 *   return () => stop();
 * }, []);
 *
 * if (error) return <div>Error: {error.message}</div>;
 *
 * return <video ref={videoRef} autoPlay playsInline />;
 * ```
 */
export function useCamera(): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [permission, setPermission] = useState<CameraPermissionState>('prompt');
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Starts the camera
   */
  const start = useCallback(async (facingMode: CameraFacingMode = 'environment') => {
    setIsLoading(true);
    setError(null);

    try {
      const mediaStream = await cameraService.startCamera(facingMode);
      setStream(mediaStream);
      setPermission('granted');
    } catch (err) {
      const error = err as Error;
      setError(error);

      // Update permission state based on error type
      if (error.name === 'PermissionDeniedError') {
        setPermission('denied');
      } else if (error.name === 'NotSupportedError') {
        // Camera not available, but permission wasn't denied
        setPermission('prompt');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Stops the camera
   */
  const stop = useCallback(() => {
    if (stream) {
      cameraService.stopCamera(stream);
      setStream(null);
    }
  }, [stream]);

  /**
   * Switches between front and rear cameras
   */
  const switchCamera = useCallback(
    async (newFacingMode: CameraFacingMode) => {
      if (!stream) {
        throw new Error('No active camera stream to switch');
      }

      setIsLoading(true);
      setError(null);

      try {
        const newStream = await cameraService.switchCamera(stream, newFacingMode);
        setStream(newStream);
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    },
    [stream]
  );

  /**
   * Check permission on mount
   */
  useEffect(() => {
    async function checkPermissionState() {
      try {
        const state = await cameraService.checkPermission();
        setPermission(state);
      } catch {
        // Permissions API not supported, leave as 'prompt'
      }
    }

    checkPermissionState();
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (stream) {
        cameraService.stopCamera(stream);
      }
    };
  }, [stream]);

  return {
    stream,
    error,
    permission,
    isLoading,
    start,
    stop,
    switchCamera,
  };
}
