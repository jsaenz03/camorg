/**
 * Patients List Page
 *
 * Searchable grid of patients. Entry point for User Story 2.
 */

'use client';

import { useState, useCallback } from 'react';
import { PatientList } from '@/components/patient/patient-list';
import { PageHeader } from '@/components/page-header';
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
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Patients"
        description="Search and review patient photo timelines."
      />

      <PatientList
        patients={patients}
        isLoading={isLoading}
        error={error}
        onSearch={handleSearch}
      />
    </div>
  );
}
