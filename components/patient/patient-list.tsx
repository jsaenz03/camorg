/**
 * PatientList Component
 *
 * Searchable patient browser with a grid/table view toggle. Uses usePatients
 * (via the page) for data management.
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Table as TableIcon, AlertCircle, Users, SearchX } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { PatientCard } from './patient-card';
import { PatientsDataTable } from './patients-data-table';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PatientListProps {
  patients: Patient[];
  isLoading: boolean;
  error: Error | null;
  onSearch: (term: string) => void;
}

export function PatientList({ patients, isLoading, error, onSearch }: PatientListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const router = useRouter();

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchTerm(value);
      onSearch(value);
    },
    [onSearch],
  );

  const handlePatientClick = useCallback(
    (patientId: string) => {
      router.push(`/patients/view?id=${patientId}`);
    },
    [router],
  );

  const SearchInput = (
    <Input
      type="search"
      placeholder="Search patients by name..."
      value={searchTerm}
      onChange={handleSearchChange}
      className="max-w-md"
      disabled={isLoading && patients.length === 0}
    />
  );

  const ViewToggle = (
    <Tabs value={view} onValueChange={(v) => setView(v as 'grid' | 'table')}>
      <TabsList>
        <TabsTrigger value="grid" aria-label="Grid view">
          <LayoutGrid className="size-4" />
          Grid
        </TabsTrigger>
        <TabsTrigger value="table" aria-label="Table view">
          <TableIcon className="size-4" />
          Table
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (isLoading && patients.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">{SearchInput}</div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {SearchInput}
        <EmptyState
          icon={AlertCircle}
          tone="destructive"
          title="Error loading patients"
          description={error.message}
        />
      </div>
    );
  }

  if (patients.length === 0 && !searchTerm) {
    return (
      <div className="space-y-4">
        {SearchInput}
        <EmptyState
          icon={Users}
          title="No patients yet"
          description="Patients will appear here after capturing your first photo"
        />
      </div>
    );
  }

  if (patients.length === 0 && searchTerm) {
    return (
      <div className="space-y-4">
        {SearchInput}
        <EmptyState
          icon={SearchX}
          title="No patients found"
          description={`No patients match "${searchTerm}"`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {SearchInput}
        <div className="flex items-center gap-3">
          <p className="hidden text-sm text-muted-foreground sm:block">
            {patients.length} {patients.length === 1 ? 'patient' : 'patients'}
          </p>
          {ViewToggle}
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {patients.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              onClick={() => handlePatientClick(patient.id)}
            />
          ))}
        </div>
      ) : (
        <PatientsDataTable patients={patients} />
      )}
    </div>
  );
}
