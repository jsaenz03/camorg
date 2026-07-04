/**
 * Patients List Page
 *
 * Displays all patients with search functionality.
 * Entry point for User Story 2: View Patient Timeline
 */

'use client';

import { useState, useCallback } from 'react';
import { PatientList } from '@/components/patient/patient-list';
import { usePatients } from '@/lib/hooks/use-patients';

export default function PatientsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const { patients, isLoading, error, search } = usePatients({
    includeArchived: false,
  });

  const handleSearch = useCallback(
    (term: string) => {
      setSearchTerm(term);
      search(term);
    },
    [search]
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Patients</h1>
        <p className="text-muted-foreground">
          View and search patient records
        </p>
      </div>

      <PatientList
        patients={patients}
        isLoading={isLoading}
        error={error}
        onSearch={handleSearch}
      />
    </div>
  );
}
