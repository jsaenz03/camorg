'use client';

/**
 * Admin: photo storage location. Points photo files at a local folder or a
 * cloud-synced folder (OneDrive, Dropbox, iCloud Drive). Changing location
 * copies existing photos; the database always stays on this machine.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { FolderOpen, HardDrive, Loader2, RotateCcw } from 'lucide-react';

import type { StorageInfo } from '@/lib/services/storage-service';
import { storageService } from '@/lib/services/storage-service';
import { toErrorMessage } from '@/lib/utils/error-message';
import {
  StorageCleanupDialog,
  type StorageCleanup,
} from '@/components/settings/storage-cleanup-dialog';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function StoragePanel() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyProgress, setCopyProgress] = useState<{ copied: number; total: number } | null>(null);
  const [cleanup, setCleanup] = useState<StorageCleanup | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await storageService.getStorageInfo());
      setLoadError(null);
    } catch (err) {
      // Most likely an offline network/cloud drive — shown inline with a
      // recovery path rather than as a bare toast.
      setInfo(null);
      setLoadError(toErrorMessage(err, 'Failed to load storage settings'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickFolder() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      if (info && picked === info.resolvedDir) return;

      const ok = await confirm(
        'Store photos in the selected folder? Existing photos will be copied there — you can delete the originals from the old folder afterwards.',
        { title: 'Change photo storage', kind: 'info' }
      );
      if (!ok) return;

      setBusy(true);
      setCopyProgress(null);
      const result = await storageService.changePhotosDir(picked, {
        onProgress: (copied, total) => setCopyProgress({ copied, total }),
      });
      await load();
      toast.success(
        result.moved > 0
          ? `Copied ${result.moved} photo file${result.moved === 1 ? '' : 's'} to the new folder`
          : 'Photo storage updated'
      );
      // Copied files still sit in the old folder — offer the cleanup once
      // the copy is confirmed, never before.
      if (result.sourceFiles.length > 0 && result.sourceDir) {
        setCleanup({
          sourceDir: result.sourceDir,
          files: result.sourceFiles,
          activeDir: result.activeDir,
        });
      }
    } catch (err) {
      toast.error(toErrorMessage(err, 'Could not change photo storage'));
    } finally {
      setBusy(false);
      setCopyProgress(null);
    }
  }

  async function resetToDefault() {
    try {
      const ok = await confirm(
        'Move photo storage back to the default app folder? Existing photos will be copied there — you can delete the originals from the old folder afterwards.',
        { title: 'Reset photo storage', kind: 'info' }
      );
      if (!ok) return;

      setBusy(true);
      setCopyProgress(null);
      const result = await storageService.changePhotosDir(null, {
        onProgress: (copied, total) => setCopyProgress({ copied, total }),
      });
      await load();
      toast.success(
        result.moved > 0
          ? `Copied ${result.moved} photo file${result.moved === 1 ? '' : 's'} to the default folder`
          : 'Photo storage updated'
      );
      if (result.sourceFiles.length > 0 && result.sourceDir) {
        setCleanup({
          sourceDir: result.sourceDir,
          files: result.sourceFiles,
          activeDir: result.activeDir,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'StorageUnavailableError') {
        // Current folder is an offline drive: offer to repoint without the
        // copy. Photos stay on the drive and reappear if Camog is pointed
        // back at it once reconnected.
        const skip = await confirm(
          'The current photo folder is unavailable, so existing photos can’t be copied. Switch to the default folder anyway? Photos stay on the unavailable folder.',
          { title: 'Photo folder unavailable', kind: 'warning' }
        );
        if (!skip) return;
        try {
          setBusy(true);
          await storageService.changePhotosDir(null, { allowMissingSource: true });
          await load();
          toast.success('Photo storage moved to the default folder (no photos copied — the previous folder was unavailable)');
        } catch (retryErr) {
          toast.error(toErrorMessage(retryErr, 'Could not change photo storage'));
        }
      } else {
        toast.error(toErrorMessage(err, 'Could not change photo storage'));
      }
    } finally {
      setBusy(false);
      setCopyProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Photo storage</CardTitle>
        <CardDescription>
          Where photo files are saved. The database stays on this machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <FolderOpen className="size-4 text-muted-foreground" />
              {loadError}
            </div>
            <p className="mb-3 mt-1 text-muted-foreground">
              Reconnect the drive, or switch to the default folder on this
              machine. Photos on the unavailable folder stay there and reappear
              if you point Camog back at it later.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetToDefault}
                disabled={busy}
              >
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RotateCcw className="mr-2 size-4" />}
                Use default folder
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {info?.customDir ? (
                <FolderOpen className="size-4 text-muted-foreground" />
              ) : (
                <HardDrive className="size-4 text-muted-foreground" />
              )}
              Current location
              {info && (
                <Badge variant={info.customDir ? 'default' : 'secondary'}>
                  {info.customDir ? 'Custom folder' : 'Default'}
                </Badge>
              )}
            </div>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {info ? info.resolvedDir : '…'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={pickFolder} disabled={!info || busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Choose folder…
          </Button>
          {info?.customDir && (
            <Button variant="outline" onClick={resetToDefault} disabled={busy}>
              <RotateCcw className="mr-2 size-4" />
              Use default folder
            </Button>
          )}
        </div>

        {copyProgress && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Copying {copyProgress.copied} of {copyProgress.total}{' '}
              file{copyProgress.total === 1 ? '' : 's'} to the new folder…
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${
                    copyProgress.total > 0
                      ? Math.round((copyProgress.copied / copyProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Pick a local folder or a cloud-synced folder (OneDrive, Dropbox, iCloud
          Drive) to keep photos in cloud storage. Copies are one-way — deleting
          photos from the folder outside Camog will make them unreadable in the
          app.
        </p>
      </CardContent>

      <StorageCleanupDialog cleanup={cleanup} onClose={() => setCleanup(null)} />
    </Card>
  );
}
