/**
 * PatientList Component
 *
 * Displays a list of patients with search functionality.
 * Uses usePatients hook for data management.
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Users, SearchX } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { PatientCard } from './patient-card';
import { EmptyState } from '@/components/empty-state';
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
        <EmptyState
          icon={AlertCircle}
          tone="destructive"
          title="Error loading patients"
          description={error.message}
        />
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
        <EmptyState
          icon={Users}
          title="No patients yet"
          description="Patients will appear here after capturing your first photo"
        />
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
        <EmptyState
          icon={SearchX}
          title="No patients found"
          description={`No patients match "${searchTerm}"`}
        />
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
