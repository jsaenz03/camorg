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
import type { DueReviewCounts } from './photo-review-due-badge';

interface PatientListProps {
  patients: Patient[];
  isLoading: boolean;
  error: Error | null;
  onSearch: (term: string) => void;
  /** Photos due for review per patient id (grid cards + table rows). */
  dueByPatient?: Map<string, DueReviewCounts>;
}

export function PatientList({ patients, isLoading, error, onSearch, dueByPatient }: PatientListProps) {
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
      placeholder="Search by name or date of birth (e.g. 4/2/85)…"
      value={searchTerm}
      onChange={handleSearchChange}
      className="max-w-md"
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

  // The toolbar stays mounted in one place across every list state. The
  // search input used to live in per-branch JSX, so flipping between
  // results / no-results remounted it mid-typing — focus fell to the page
  // body and the next Delete keypress became WKWebView's history-back,
  // yanking the user off the page (to the old /capture route) mid-search.
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {SearchInput}
      {patients.length > 0 && (
        <div className="flex items-center gap-3">
          <p className="hidden text-sm text-muted-foreground sm:block">
            {patients.length} {patients.length === 1 ? 'patient' : 'patients'}
          </p>
          {ViewToggle}
        </div>
      )}
    </div>
  );

  if (isLoading && patients.length === 0) {
    return (
      <div className="space-y-4">
        {toolbar}
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
        {toolbar}
        <EmptyState
          icon={AlertCircle}
          tone="destructive"
          title="Error loading patients"
          description={error.message}
        />
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="space-y-4">
        {toolbar}
        <EmptyState
          icon={searchTerm ? SearchX : Users}
          title={searchTerm ? 'No patients found' : 'No patients yet'}
          description={
            searchTerm
              ? `No patients match "${searchTerm}"`
              : 'Patients will appear here after capturing your first photo'
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {view === 'grid' ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {patients.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              due={dueByPatient?.get(patient.id)}
              onClick={() => handlePatientClick(patient.id)}
            />
          ))}
        </div>
      ) : (
        <PatientsDataTable patients={patients} dueByPatient={dueByPatient} />
      )}
    </div>
  );
}
