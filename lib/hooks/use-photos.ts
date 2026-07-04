/**
 * usePhotos Hook
 *
 * Manages photo data loading and state for patient timelines and search results.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
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

  const loadPhotos = useCallback(async () => {
    if (!patientId) {
      setPhotos([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await photoService.getPhotosByPatient(patientId, {
        includeDeleted,
        bodyPart,
      });
      setPhotos(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load photos'));
      setPhotos([]);
    } finally {
      setIsLoading(false);
    }
  }, [patientId, bodyPart, includeDeleted]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const refresh = useCallback(async () => {
    await loadPhotos();
  }, [loadPhotos]);

  return {
    photos,
    isLoading,
    error,
    refresh,
  };
}
