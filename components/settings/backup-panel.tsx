'use client';

/**
 * Admin: one-click database backup + manual restore instructions.
 * See lib/services/backup-service.ts for the VACUUM INTO approach.
 */

import { useEffect, useState } from 'react';
import { Database, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { backupService } from '@/lib/services/backup-service';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from 'sonner';

/** Nudge threshold: older than this (or never) shows the staleness warning. */
const STALE_AFTER_DAYS = 7;

export function BackupPanel() {
  const [isBacking, setIsBacking] = useState(false);
  const [lastBackup, setLastBackup] = useState<{ path: string; createdAt: Date } | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    backupService
      .getLastBackupAt()
      .then((at) => {
        setStale(at === null || Date.now() - at.getTime() > STALE_AFTER_DAYS * 86_400_000);
      })
      .catch(() => {}); // can't read the folder — don't nag on top of it
  }, []);

  async function handleBackup() {
    setIsBacking(true);
    try {
      const result = await backupService.createBackup();
      setLastBackup(result);
      setStale(false);
      toast.success('Backup created');
    } catch (err) {
      toast.error(
        err instanceof Error ? `Backup failed: ${err.message}` : 'Backup failed. Please try again.',
      );
    } finally {
      setIsBacking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" /> Backup &amp; restore
        </CardTitle>
        <CardDescription>
          The database (patients, photo metadata, users) lives only on this machine — back it up
          to the photo storage folder regularly, especially when that folder is cloud-synced.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stale && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              No recent backup found. Everything lives on this one disk — a disk
              failure loses patients, metadata and photos. Back up now, or point
              storage at a cloud-synced folder.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleBackup} disabled={isBacking}>
            {isBacking ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Back up database now
          </Button>
          {lastBackup && (
            <p className="text-sm text-muted-foreground" title={lastBackup.path}>
              Last backup: {lastBackup.createdAt.toLocaleString()} — {lastBackup.path}
            </p>
          )}
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">To restore a backup</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Quit Camog completely.</li>
            <li>
              In the app data folder
              (<code className="rounded bg-muted px-1">…/com.camog.app</code> on Windows,
              {' '}<code className="rounded bg-muted px-1">~/Library/Application Support/com.camog.app</code> on macOS),
              replace <code className="rounded bg-muted px-1">camog.db</code> with the backup file.
            </li>
            <li>Rename the copy to <code className="rounded bg-muted px-1">camog.db</code> and start Camog.</li>
          </ol>
          <p className="mt-2 text-muted-foreground">
            Photos are restored by pointing Settings → Storage at the folder that holds them.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
