'use client';

/**
 * Admin: read-only audit trail viewer. Newest first, latest 200 entries.
 * (Ponytail: fixed page size. Upgrade path: date filters + CSV export.)
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ScrollText } from 'lucide-react';
import type { AuditEntry } from '@/types/audit';
import { AuditActionLabels } from '@/types/audit';
import { auditService } from '@/lib/services/audit-service';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    auditService
      .list({ limit: 200 })
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setEntries([]);
          toast.error(
            err instanceof Error ? err.message : 'Failed to load audit log',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" /> Audit log
        </CardTitle>
        <CardDescription>
          Who did what, when — logins, patient and photo changes, consent records,
          exports and backups. Newest first; latest 200 entries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries === null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No audit entries yet — activity will appear here as the app is used.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Who</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums">
                      {format(entry.createdAt, 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td className="py-2 pr-4">{entry.clinicianName || 'Unknown'}</td>
                    <td className="py-2 pr-4">
                      {AuditActionLabels[entry.action] ?? entry.action}
                    </td>
                    <td className="max-w-64 truncate py-2 text-muted-foreground" title={entry.detail ?? ''}>
                      {entry.detail ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
