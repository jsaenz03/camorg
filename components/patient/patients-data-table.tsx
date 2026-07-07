/**
 * PatientsDataTable
 *
 * shadcn Table view of patients: name, photos, last capture, registered.
 * Row click navigates to the patient timeline. Column headers sort the rows
 * client-side (datasets are small, single-user desktop app).
 */

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { formatRelativeTime } from '@/lib/utils/date-formatting';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type SortKey = 'name' | 'photoCount' | 'lastPhotoAt' | 'createdAt';
type SortDir = 'asc' | 'desc';

interface PatientsDataTableProps {
  patients: Patient[];
  className?: string;
}

export function PatientsDataTable({ patients, className }: PatientsDataTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('lastPhotoAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const rows = [...patients];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'photoCount':
          cmp = a.photoCount - b.photoCount;
          break;
        case 'lastPhotoAt': {
          const at = a.lastPhotoAt?.getTime() ?? 0;
          const bt = b.lastPhotoAt?.getTime() ?? 0;
          cmp = at - bt;
          break;
        }
        case 'createdAt':
          cmp = a.createdAt.getTime() - b.createdAt.getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [patients, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <div className={cn('rounded-xl border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader label="Patient" sortKey="name" current={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortHeader label="Photos" sortKey="photoCount" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-24 text-right" />
            <SortHeader label="Last capture" sortKey="lastPhotoAt" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-40" />
            <SortHeader label="Registered" sortKey="createdAt" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((patient) => (
            <TableRow
              key={patient.id}
              onClick={() => router.push(`/patients/view?id=${patient.id}`)}
              className="cursor-pointer"
            >
              <TableCell className="font-medium">{patient.name}</TableCell>
              <TableCell className="text-right">
                <Badge variant="secondary">{patient.photoCount}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {patient.lastPhotoAt ? formatRelativeTime(patient.lastPhotoAt) : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {format(patient.createdAt, 'd MMM yyyy')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 gap-1 px-2 data-[active=true]:font-medium"
        data-active={active}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" />
        )}
      </Button>
    </TableHead>
  );
}
