/**
 * usePhotos Hook
 *
 * Manages photo data loading and state for patient timelines and search results.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';

interface UsePhotosOptions {
  patientId?: string;
  bodyPart?: BodyPart;
  includeDeleted?: boolean;
}

interface UsePhotosReturn {
  photos: PhotoRecord[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook for loading and managing photo data
 *
 * @param options - Filter options for photos
 * @returns Photo data, loading state, error state, and refresh function
 */
export function usePhotos(options: UsePhotosOptions = {}): UsePhotosReturn {
  const { patientId, bodyPart, includeDeleted = false } = options;

  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Monotonic sequence: a slow response from a previous patient must not
  // commit over the current one (same guard as use-patients).
  const seqRef = useRef(0);

  // A background refresh keeps the current photos on screen: flipping
  // isLoading would render the page skeleton and flash any open dialog
  // (e.g. Mark reviewed in the photo detail dialog) away mid-action.
  const loadPhotos = useCallback(async (background = false) => {
    if (!patientId) {
      setPhotos([]);
      setIsLoading(false);
      return;
    }

    const seq = ++seqRef.current;
    if (!background) setIsLoading(true);
    setError(null);

    try {
      const data = await photoService.getPhotosByPatient(patientId, {
        includeDeleted,
        bodyPart,
      });
      if (seq !== seqRef.current) return;
      setPhotos(data);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to load photos'));
      setPhotos([]);
    } finally {
      if (seq === seqRef.current) setIsLoading(false);
    }
  }, [patientId, bodyPart, includeDeleted]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const refresh = useCallback(async () => {
    await loadPhotos(true);
  }, [loadPhotos]);

  return {
    photos,
    isLoading,
    error,
    refresh,
  };
}
