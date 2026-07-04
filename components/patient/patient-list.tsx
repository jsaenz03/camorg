/**
 * PatientList Component
 *
 * Displays a list of patients with search functionality.
 * Uses usePatients hook for data management.
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Patient } from '@/types/patient';
import { PatientCard } from './patient-card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface PatientListProps {
  patients: Patient[];
  isLoading: boolean;
  error: Error | null;
  onSearch: (term: string) => void;
}

/**
 * PatientList displays a searchable list of patients
 */
export function PatientList({ patients, isLoading, error, onSearch }: PatientListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchTerm(value);
      onSearch(value);
    },
    [onSearch]
  );

  const handlePatientClick = useCallback(
    (patientId: string) => {
      router.push(`/patients/view?id=${patientId}`);
    },
    [router]
  );

  // Loading state
  if (isLoading && patients.length === 0) {
    return (
      <div className="space-y-4">
        <Input
          type="search"
          placeholder="Search patients by name..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="max-w-md"
          disabled
        />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-4">
        <Input
          type="search"
          placeholder="Search patients by name..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="max-w-md"
        />
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-destructive"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Error loading patients</h3>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (patients.length === 0 && !searchTerm) {
    return (
      <div className="space-y-4">
        <Input
          type="search"
          placeholder="Search patients by name..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="max-w-md"
          disabled
        />
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">No patients yet</h3>
          <p className="text-sm text-muted-foreground">
            Patients will appear here after capturing your first photo
          </p>
        </div>
      </div>
    );
  }

  // Empty search results
  if (patients.length === 0 && searchTerm) {
    return (
      <div className="space-y-4">
        <Input
          type="search"
          placeholder="Search patients by name..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="max-w-md"
        />
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">No patients found</h3>
          <p className="text-sm text-muted-foreground">
            No patients match &quot;{searchTerm}&quot;
          </p>
        </div>
      </div>
    );
  }

  // Patient list
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          type="search"
          placeholder="Search patients by name..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="max-w-md"
        />
        <p className="text-sm text-muted-foreground">
          {patients.length} {patients.length === 1 ? 'patient' : 'patients'}
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {patients.map((patient) => (
          <PatientCard
            key={patient.id}
            patient={patient}
            onClick={() => handlePatientClick(patient.id)}
          />
        ))}
      </div>
    </div>
  );
}
