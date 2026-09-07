'use client';

/**
 * StorageCleanupDialog — the optional second step after changing the photo
 * storage folder. The change copies; this offers to permanently delete the
 * copied files from the OLD folder.
 *
 * Confirmation matches the patient hard-delete pattern: type the old
 * folder's name to enable the button. The service double-checks every file
 * (Camog-named, verified copy at the new location) before removing it, so
 * this dialog is the human gate, not the only one.
 *
 * Deletion runs with a live progress bar and a Stop button — large folders
 * take a while (several filesystem checks per file) and the operator must
 * never face a silent, immovable modal. Stop ends the batch after the
 * current file; files already deleted stay deleted, the rest are kept.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { storageService } from '@/lib/services/storage-service';
import { toErrorMessage } from '@/lib/utils/error-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface StorageCleanup {
  /** Directory the files were copied from (old storage location). */
  sourceDir: string;
  /** File names copied during the storage change. */
  files: string[];
  /** Directory photos resolve against now (copy verified against this). */
  activeDir: string;
}

function folderNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Compose the completion toast from the outcome — every fate is named. */
function outcomeMessage(r: {
  deleted: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  total: number;
}): string {
  const parts = [`deleted ${r.deleted} of ${r.total} file${r.total === 1 ? '' : 's'}`];
  if (r.cancelled) parts.push('stopped early — the rest are kept');
  if (r.skipped > 0) parts.push(`${r.skipped} kept (copy not verified — check the new folder)`);
  if (r.failed > 0) parts.push(`${r.failed} failed and were kept`);
  return `Old folder: ${parts.join(' · ')}`;
}

interface StorageCleanupDialogProps {
  cleanup: StorageCleanup | null;
  onClose: () => void;
}

export function StorageCleanupDialog({ cleanup, onClose }: StorageCleanupDialogProps) {
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  // State drives the button; the ref is what the service loop reads.
  const stopRequested = useRef(false);

  // Reset the typed phrase, progress, and any Stop request each time the
  // dialog is offered.
  useEffect(() => {
    if (cleanup) {
      setConfirmName('');
      setBusy(false);
      setProgress(null);
      setStopping(false);
      stopRequested.current = false;
    }
  }, [cleanup]);

  if (!cleanup) return null;
  const folderName = folderNameOf(cleanup.sourceDir);
  const canDelete = !busy && confirmName.trim() === folderName;

  async function deleteFiles() {
    if (!cleanup) return;
    setBusy(true);
    setProgress({ done: 0, total: cleanup.files.length });
    try {
      const result = await storageService.deleteSourceFiles(
        cleanup.sourceDir,
        cleanup.files,
        cleanup.activeDir,
        {
          onProgress: (done, total) => setProgress({ done, total }),
          isCancelled: () => stopRequested.current,
        },
      );
      toast.success(outcomeMessage({ ...result, total: cleanup.files.length }));
      onClose();
    } catch (err) {
      // Files are untouched — show why it failed; deleting the folder by
      // hand later is always the fallback.
      toast.error(toErrorMessage(err, 'Could not delete the old files'));
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    stopRequested.current = true;
    setStopping(true);
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  const shown = progress
    ? `${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
    : 'files';

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-4" />
            Delete photos from the old folder?
          </DialogTitle>
          <DialogDescription>
            {cleanup.files.length} photo file{cleanup.files.length === 1 ? ' was' : 's were'}{' '}
            copied to the new location. The cop{cleanup.files.length === 1 ? 'y' : 'ies'} still{' '}
            sit{cleanup.files.length === 1 ? 's' : ''} in the old folder:
          </DialogDescription>
        </DialogHeader>

        <p className="break-all rounded-md border p-2 font-mono text-xs text-muted-foreground">
          {cleanup.sourceDir}
        </p>

        {busy ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Deleting {shown}… each file is checked against the new folder first
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Files in the old folder are permanently deleted — this can&rsquo;t be undone.</li>
            <li>
              Only Camog photo files with a verified copy in the new folder are deleted; the folder
              itself is kept.
            </li>
            <li>
              Prefer keeping them? Close this — the duplicates are harmless and you can delete the
              folder yourself later.
            </li>
          </ul>
        )}

        {!busy && (
          <div className="space-y-2">
            <Label htmlFor="storage-cleanup-confirm">
              Type <span className="font-semibold text-foreground">{folderName}</span> to confirm
            </Label>
            <Input
              id="storage-cleanup-confirm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={folderName}
              autoComplete="off"
            />
          </div>
        )}

        <DialogFooter>
          {busy ? (
            <Button variant="outline" onClick={stop} disabled={stopping}>
              {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Keep files
              </Button>
              <Button variant="destructive" disabled={!canDelete} onClick={() => void deleteFiles()}>
                <Trash2 className="size-4" />
                Delete {cleanup.files.length} file{cleanup.files.length === 1 ? '' : 's'} permanently
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
