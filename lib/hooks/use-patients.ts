/**
 * usePatients Hook
 *
 * Manages patient data loading, search, and state.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Patient } from '@/types/patient';
import { patientService } from '@/lib/services/patient-service';

interface UsePatientsOptions {
  includeArchived?: boolean;
  searchTerm?: string;
}

interface UsePatientsReturn {
  patients: Patient[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  search: (term: string) => void;
}

// Debounce for search-as-you-type so each keystroke doesn't hit SQLite.
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Hook for loading and managing patient data
 *
 * @param options - Filter options for patients
 * @returns Patient data, loading state, error state, refresh and search functions
 */
export function usePatients(options: UsePatientsOptions = {}): UsePatientsReturn {
  const { includeArchived = false, searchTerm = '' } = options;

  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [currentSearchTerm, setCurrentSearchTerm] = useState(searchTerm);

  // Monotonic request id: only the most recent load may commit state, so a
  // slow earlier response (e.g. a partial search term while the user is
  // deleting) can't overwrite the result of a newer one.
  const loadSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const loadPatients = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    setError(null);

    try {
      let data: Patient[];

      if (currentSearchTerm.trim()) {
        // Use search if term provided
        data = await patientService.searchPatients(currentSearchTerm, {
          includeArchived,
        });
      } else {
        // Load all patients
        data = await patientService.getAllPatients({
          includeArchived,
        });
      }

      if (seq !== loadSeqRef.current) return;
      setPatients(data);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to load patients'));
      setPatients([]);
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false);
    }
  }, [currentSearchTerm, includeArchived]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const refresh = useCallback(async () => {
    await loadPatients();
  }, [loadPatients]);

  const search = useCallback((term: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setCurrentSearchTerm(term), SEARCH_DEBOUNCE_MS);
  }, []);

  return {
    patients,
    isLoading,
    error,
    refresh,
    search,
  };
}
