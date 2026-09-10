'use client';

/**
 * Admin: one-click passphrase-encrypted database backup + one-click staged
 * restore (restart applies the swap — see lib/services/backup-service.ts and
 * src-tauri/src/db_restore.rs) with a manual prepare-a-copy fallback.
 */

import { useEffect, useState } from 'react';
import {
  Database,
  FileDown,
  Loader2,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { backupService, MIN_PASSPHRASE_LENGTH } from '@/lib/services/backup-service';
import { confirmDialog } from '@/lib/utils/confirm';
import type { BackupInfo } from '@/lib/services/backup-service';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PasswordInput } from '@/components/ui/password-input';
import { toast } from 'sonner';

/** Nudge threshold: older than this (or never) shows the staleness warning. */
const STALE_AFTER_DAYS = 7;

export function BackupPanel() {
  const [isBacking, setIsBacking] = useState(false);
  const [lastBackup, setLastBackup] = useState<{ path: string; createdAt: Date } | null>(null);
  const [stale, setStale] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [selectedBackup, setSelectedBackup] = useState<string>('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    refreshBackups();
  }, []);

  async function refreshBackups() {
    try {
      const [list, last] = await Promise.all([
        backupService.listBackups(),
        backupService.getLastBackupAt(),
      ]);
      setBackups(list);
      setSelectedBackup((current) => current || list[0]?.filename || '');
      setStale(last === null || Date.now() - last.getTime() > STALE_AFTER_DAYS * 86_400_000);
    } catch {
      // can't read the folder — don't nag on top of it
    }
  }

  const passReady =
    passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === confirmPassphrase;

  async function handleBackup() {
    if (passphrase !== confirmPassphrase) {
      toast.error('The passphrases don’t match.');
      return;
    }
    setIsBacking(true);
    try {
      const result = await backupService.createBackup(passphrase);
      setLastBackup(result);
      setStale(false);
      // Don't leave the secret sitting in form state.
      setPassphrase('');
      setConfirmPassphrase('');
      await refreshBackups();
      toast.success('Encrypted backup created');
    } catch (err) {
      toast.error(
        err instanceof Error ? `Backup failed: ${err.message}` : 'Backup failed. Please try again.',
      );
    } finally {
      setIsBacking(false);
    }
  }

  async function handleRestoreCopy() {
    if (!selectedBackup) return;
    const target = await save({
      title: 'Save the decrypted restore copy',
      defaultPath: 'camog.db',
    });
    if (!target) return; // cancelled
    setIsPreparing(true);
    try {
      await backupService.prepareRestoreCopy(selectedBackup, restorePassphrase, target);
      setRestorePassphrase('');
      toast.success('Restore copy saved', {
        description: target,
        action: {
          label: 'Show in Finder',
          onClick: () => {
            void invoke('reveal_saved_report', { path: target }).catch((e: unknown) =>
              toast.error(String(e)),
            );
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not prepare the restore copy.');
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleRestore() {
    if (!selectedBackup || isRestoring) return;
    const when = backups
      .find((b) => b.filename === selectedBackup)
      ?.createdAt.toLocaleString();
    const ok = await confirmDialog(
      `Restore the backup from ${when ?? 'the selected date'}? Camog will close and restart into the restored database — everything saved since that backup is replaced. The current database is kept as camog.pre-restore.db in the app data folder, so the restore can be undone by hand.`,
    );
    if (!ok) return;
    setIsRestoring(true);
    try {
      await backupService.restoreDatabase(selectedBackup, restorePassphrase);
      // On success the app restarts; execution never reaches here.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed. Please try again.');
      setIsRestoring(false);
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
          Backups are encrypted with a passphrase only your practice knows.
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="backup-passphrase">Backup passphrase</Label>
            <PasswordInput
              id="backup-passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backup-passphrase-confirm">Confirm passphrase</Label>
            <PasswordInput
              id="backup-passphrase-confirm"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleBackup} disabled={isBacking || !passReady}>
            {isBacking ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Back up database now
          </Button>
          {lastBackup && (
            <p className="text-sm text-muted-foreground" title={lastBackup.path}>
              Last backup: {lastBackup.createdAt.toLocaleString()} — {lastBackup.path}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          The passphrase cannot be recovered from the backup file. Losing it loses every
          encrypted backup — record it with your practice’s critical credentials. Older backups
          (before encrypted backups were introduced) are plain files and restore without a
          passphrase; delete them once a newer encrypted backup exists.
        </p>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">To restore a backup</p>
          <p className="mt-1 text-muted-foreground">
            Pick the backup below, enter its passphrase, and press{' '}
            <em>Restore</em> — Camog restarts straight into the restored
            database. The database you replaced is kept as{' '}
            <code className="rounded bg-muted px-1">camog.pre-restore.db</code> in
            the app data folder; to undo, quit Camog and swap it back over{' '}
            <code className="rounded bg-muted px-1">camog.db</code>.
          </p>
          <p className="mt-2 text-muted-foreground">
            Need a copy you can open on any machine, or restoring by hand
            (e.g. Camog won’t start)? Press <em>Prepare a restore copy</em>,
            quit Camog, and in the app data folder
            (<code className="rounded bg-muted px-1">…/com.camog.app</code> on Windows,
            {' '}<code className="rounded bg-muted px-1">~/Library/Application Support/com.camog.app</code> on macOS)
            replace <code className="rounded bg-muted px-1">camog.db</code> with it.
          </p>
          <p className="mt-2 text-muted-foreground">
            Photos are restored by pointing Settings → Storage at the folder that holds them.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="backup-restore-select">Backup</Label>
              <Select value={selectedBackup} onValueChange={setSelectedBackup}>
                <SelectTrigger id="backup-restore-select" className="w-56">
                  <SelectValue placeholder="No backups yet" />
                </SelectTrigger>
                <SelectContent>
                  {backups.map((b) => (
                    <SelectItem key={b.filename} value={b.filename}>
                      {b.createdAt.toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="backup-restore-passphrase">Passphrase</Label>
              <PasswordInput
                id="backup-restore-passphrase"
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
                className="w-56"
                autoComplete="off"
              />
            </div>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={!selectedBackup || isRestoring || isPreparing}
            >
              {isRestoring ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              Restore
            </Button>
            <Button
              variant="outline"
              onClick={handleRestoreCopy}
              disabled={!selectedBackup || isPreparing || isRestoring}
            >
              {isPreparing ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              Prepare a restore copy
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
