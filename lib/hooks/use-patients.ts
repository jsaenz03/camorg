/**
 * usePatients Hook
 *
 * Manages patient data loading, search, and state.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
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
  search: (term: string) => Promise<void>;
}

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

  const loadPatients = useCallback(async () => {
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

      setPatients(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load patients'));
      setPatients([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentSearchTerm, includeArchived]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const refresh = useCallback(async () => {
    await loadPatients();
  }, [loadPatients]);

  const search = useCallback(async (term: string) => {
    setCurrentSearchTerm(term);
  }, []);

  return {
    patients,
    isLoading,
    error,
    refresh,
    search,
  };
}
