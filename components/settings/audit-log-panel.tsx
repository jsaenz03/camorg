'use client';

/**
 * Admin: read-only audit trail viewer. Newest first, date-range filtered
 * (defaults to the last 30 days including today), latest 200 entries of the
 * range. Download CSV saves the whole filtered range, not just the visible
 * 200. (Ponytail: 10k-row export ceiling; a bigger trail needs paging or
 * streaming. Upgrade path: action/clinician filters + CSV streaming.)
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Download, ScrollText } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
// writeFile (binary), not writeTextFile — capabilities grant fs:allow-write-file
// only, and the text command needs its own permission. Same pattern as
// resultFileService.saveCopy.
import { writeFile } from '@tauri-apps/plugin-fs';
import type { AuditEntry } from '@/types/audit';
import { AuditActionLabels } from '@/types/audit';
import { auditService } from '@/lib/services/audit-service';
import { defaultAuditRange, parseYmd, toAuditCsv } from '@/lib/utils/audit';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

const PAGE_SIZE = 200;
// Hard ceiling for a report download; the on-screen table stays at 200.
const EXPORT_LIMIT = 10_000;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>(() => defaultAuditRange());
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    auditService
      .list({ limit: PAGE_SIZE, from: range.from, to: range.to })
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
  }, [range]);

  const rangeLabel = () => {
    const from = range.from ? format(range.from, 'dd/MM/yyyy') : 'start';
    const to = range.to ? format(range.to, 'dd/MM/yyyy') : 'now';
    return `, ${from} – ${to}`;
  };

  async function handleDownload() {
    setIsExporting(true);
    try {
      const rows = await auditService.list({
        limit: EXPORT_LIMIT,
        from: range.from,
        to: range.to,
      });
      const target = await save({
        title: 'Download audit log',
        defaultPath: `Camog audit log - ${format(new Date(), 'yyyy-MM-dd')}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }],
      });
      if (!target) return; // cancelled
      await writeFile(target, new TextEncoder().encode(toAuditCsv(rows)));
      void auditService.record('audit.export', {
        detail: `csv export (${rows.length} entries${rangeLabel()})`,
      });
      toast.success(`Audit log saved (${rows.length} entries)`, {
        description: target,
        action: {
          label: 'Show in Finder',
          onClick: () => {
            void invoke('reveal_saved_report', { path: target }).catch((e: unknown) =>
              toast.error(errorText(e)),
            );
          },
        },
      });
    } catch (err) {
      toast.error(errorText(err), { duration: 8000 });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" /> Audit log
        </CardTitle>
        <CardDescription>
          Who did what, to which patient and photo, when — logins, patient and
          photo changes, consent records, exports and backups. Newest first;
          latest {PAGE_SIZE} entries of the selected range. Download CSV saves
          the whole range, not just the visible page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">From</span>
            <Input
              type="date"
              className="w-36"
              value={range.from ? format(range.from, 'yyyy-MM-dd') : ''}
              onChange={(e) =>
                setRange((r) => ({ ...r, from: e.target.value ? parseYmd(e.target.value) : null }))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">To</span>
            <Input
              type="date"
              className="w-36"
              value={range.to ? format(range.to, 'yyyy-MM-dd') : ''}
              onChange={(e) =>
                setRange((r) => ({ ...r, to: e.target.value ? parseYmd(e.target.value) : null }))
              }
            />
          </label>
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={isExporting}>
              <Download className="size-4" />
              {isExporting ? 'Preparing…' : 'Download CSV'}
            </Button>
          </div>
        </div>
        {entries === null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No audit entries in this range — widen the dates to see earlier activity.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Who</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Patient</th>
                  <th className="py-2 pr-4 font-medium">Photo</th>
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
                    <td className="max-w-48 truncate py-2 pr-4" title={entry.patientName ?? ''}>
                      {entry.patientName ?? '—'}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                      {entry.photoLabel ?? '—'}
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
