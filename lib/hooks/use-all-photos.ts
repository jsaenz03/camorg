/**
 * useAllPhotos Hook
 *
 * Paged, server-filtered photo list for the global Photos browser. The
 * service applies date/body-part/patient filters and the access scope in SQL
 * and returns the matching total, so the grid pages through everything
 * instead of silently truncating at a fixed limit. Patient names are joined
 * client-side from the patients list (small, already needed by the filter
 * rail).
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  patientId?: string;
  includeDeleted?: boolean;
  pageSize?: number;
}

interface UseAllPhotosReturn {
  photos: PhotoWithPatient[];
  /** Total photos matching the current filters (across all pages). */
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  error: Error | null;
  loadMore: () => void;
  refresh: () => Promise<void>;
}

export function useAllPhotos(options: UseAllPhotosOptions = {}): UseAllPhotosReturn {
  const { from, to, bodyPart, patientId, includeDeleted = false, pageSize = 200 } = options;

  const [photos, setPhotos] = useState<PhotoWithPatient[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Monotonic sequence: a slow response from a previous filter must not
  // commit over a newer one (same guard as use-patients).
  const seqRef = useRef(0);

  // Any filter change resets to the first page.
  const filterKey = `${from?.getTime() ?? ''}|${to?.getTime() ?? ''}|${bodyPart ?? ''}|${patientId ?? ''}|${includeDeleted}`;
  useEffect(() => {
    setPages(1);
  }, [filterKey]);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const [page, patients] = await Promise.all([
        photoService.getPhotosPage({
          from,
          to,
          bodyPart,
          patientId,
          includeDeleted,
          limit: pageSize * pages,
          offset: 0,
        }),
        patientService.getAllPatients({ includeArchived: true }),
      ]);
      if (seq !== seqRef.current) return;
      const nameById = new Map(patients.map((p) => [p.id, p.name]));
      setPhotos(
        page.photos.map((photo) => ({
          ...photo,
          patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
        })),
      );
      setTotal(page.total);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to load photos'));
      setPhotos([]);
      setTotal(0);
    } finally {
      if (seq === seqRef.current) setIsLoading(false);
    }
  }, [from, to, bodyPart, patientId, includeDeleted, pageSize, pages]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(() => {
    setPages((p) => p + 1); // the load effect refetches with the larger limit
  }, []);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return {
    photos,
    total,
    hasMore: photos.length < total,
    isLoading,
    error,
    loadMore,
    refresh,
  };
}
