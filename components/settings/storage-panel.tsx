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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await storageService.getStorageInfo());
    } catch (err) {
      toast.error(toErrorMessage(err, 'Failed to load storage settings'));
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
        'Store photos in the selected folder? Existing photos will be copied there (originals are kept).',
        { title: 'Change photo storage', kind: 'info' }
      );
      if (!ok) return;

      setBusy(true);
      const result = await storageService.changePhotosDir(picked);
      await load();
      toast.success(
        result.moved > 0
          ? `Copied ${result.moved} photo file${result.moved === 1 ? '' : 's'} to the new folder`
          : 'Photo storage updated'
      );
    } catch (err) {
      toast.error(toErrorMessage(err, 'Could not change photo storage'));
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    try {
      const ok = await confirm(
        'Move photo storage back to the default app folder? Existing photos will be copied there (originals are kept).',
        { title: 'Reset photo storage', kind: 'info' }
      );
      if (!ok) return;

      setBusy(true);
      const result = await storageService.changePhotosDir(null);
      await load();
      toast.success(
        result.moved > 0
          ? `Copied ${result.moved} photo file${result.moved === 1 ? '' : 's'} to the default folder`
          : 'Photo storage updated'
      );
    } catch (err) {
      toast.error(toErrorMessage(err, 'Could not change photo storage'));
    } finally {
      setBusy(false);
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

        <p className="text-xs text-muted-foreground">
          Pick a local folder or a cloud-synced folder (OneDrive, Dropbox, iCloud
          Drive) to keep photos in cloud storage. Copies are one-way — deleting
          photos from the folder outside Camog will make them unreadable in the
          app.
        </p>
      </CardContent>
    </Card>
  );
}
