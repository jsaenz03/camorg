/**
 * useAllPhotos Hook
 *
 * Loads photos across all patients for the dashboard charts/calendar and the
 * global Photos browser. Joins patient names and supports the same filters as
 * photoService.getAllPhotos. Replaces the N+1 per-patient pattern that the
 * legacy home page used.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import { photoService } from '@/lib/services/photo-service';
import { patientService } from '@/lib/services/patient-service';

export interface PhotoWithPatient extends PhotoRecord {
  patientName: string;
}

interface UseAllPhotosOptions {
  from?: Date;
  to?: Date;
  bodyPart?: BodyPart;
  includeDeleted?: boolean;
  limit?: number;
}

interface UseAllPhotosReturn {
  photos: PhotoWithPatient[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useAllPhotos(options: UseAllPhotosOptions = {}): UseAllPhotosReturn {
  const { from, to, bodyPart, includeDeleted = false, limit } = options;

  const [photos, setPhotos] = useState<PhotoWithPatient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [allPhotos, patients] = await Promise.all([
        photoService.getAllPhotos({ from, to, bodyPart, includeDeleted, limit }),
        patientService.getAllPatients({ includeArchived: true }),
      ]);
      const nameById = new Map(patients.map((p) => [p.id, p.name]));
      setPhotos(
        allPhotos.map((photo) => ({
          ...photo,
          patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load photos'));
      setPhotos([]);
    } finally {
      setIsLoading(false);
    }
  }, [from, to, bodyPart, includeDeleted, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { photos, isLoading, error, refresh };
}
