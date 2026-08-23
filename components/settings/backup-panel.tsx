'use client';

/**
 * Admin: one-click database backup + manual restore instructions.
 * See lib/services/backup-service.ts for the VACUUM INTO approach.
 */

import { useState } from 'react';
import { Database, Loader2, ShieldCheck } from 'lucide-react';
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

export function BackupPanel() {
  const [isBacking, setIsBacking] = useState(false);
  const [lastBackup, setLastBackup] = useState<{ path: string; createdAt: Date } | null>(null);

  async function handleBackup() {
    setIsBacking(true);
    try {
      const result = await backupService.createBackup();
      setLastBackup(result);
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
