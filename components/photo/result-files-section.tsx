/**
 * ResultFilesSection
 *
 * Per-photo attachments: pathology reports, referral letters — any document
 * the clinician wants filed against this specific photo. Uploads copy the
 * picked file into {photosDir}/results (resultFileService); clicking a file
 * opens it in the in-app viewer (ResultFileViewer — PDF/image/text with
 * zoom, rotate and page controls; no copy written to disk), and "Save a
 * copy" is there for formats the viewer can't render or when the clinician
 * wants the file outside Camog. Remove is a two-step soft delete. Deleted
 * photos show their files read-only.
 */

'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Download,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { ResultFileRecord } from '@/types/result-file';
import { RESULT_FILE_DIALOG_FILTER } from '@/types/result-file';
import { resultFileService } from '@/lib/services/result-file-service';
import { ResultFileViewer } from '@/components/photo/result-file-viewer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ResultFilesSection({
  photoId,
  isDeleted,
}: {
  photoId: string;
  isDeleted: boolean;
}) {
  const [files, setFiles] = useState<ResultFileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // The file open in the in-app viewer, if any.
  const [viewing, setViewing] = useState<ResultFileRecord | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    resultFileService
      .listByPhoto(photoId)
      .then((list) => {
        if (mounted) setFiles(list);
      })
      .catch(() => {
        if (mounted) toast.error('Failed to load result files');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [photoId]);

  async function refresh() {
    const list = await resultFileService.listByPhoto(photoId);
    setFiles(list);
  }

  async function handleUpload() {
    const picked = await open({
      title: 'Attach result file',
      multiple: false,
      filters: [RESULT_FILE_DIALOG_FILTER],
    });
    if (typeof picked !== 'string') return; // cancelled
    setIsUploading(true);
    try {
      await resultFileService.upload(photoId, picked);
      toast.success('Result file attached');
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setIsUploading(false);
      setConfirmRemoveId(null);
    }
  }

  async function handleSaveCopy(file: ResultFileRecord) {
    const target = await save({
      title: 'Save a copy',
      defaultPath: file.originalName,
    });
    if (!target) return; // cancelled
    setBusyId(file.id);
    try {
      await resultFileService.saveCopy(file.id, target);
      toast.success('Copy saved', {
        description: target,
        action: {
          label: 'Show in Finder',
          onClick: () => {
            void invoke('reveal_saved_report', { path: target }).catch((e: unknown) =>
              toast.error(errorText(e))
            );
          },
        },
      });
    } catch (err) {
      toast.error(errorText(err), { duration: 8000 });
    } finally {
      setBusyId(null);
      setConfirmRemoveId(null);
    }
  }

  async function handleRemove(file: ResultFileRecord) {
    if (confirmRemoveId !== file.id) {
      setConfirmRemoveId(file.id);
      return;
    }
    setBusyId(file.id);
    try {
      await resultFileService.delete(file.id);
      toast.success('Result file removed');
      setViewing((current) => (current?.id === file.id ? null : current));
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusyId(null);
      setConfirmRemoveId(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Result files</Label>
        {!isDeleted && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleUpload()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
            Attach file
          </Button>
        )}
      </div>

      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No result files attached. Add pathology reports, letters or other
          documents that belong with this photo.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((file) => {
            const confirming = confirmRemoveId === file.id;
            const busy = busyId === file.id;
            return (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block w-full truncate text-left text-sm underline-offset-2 hover:underline"
                    title={`Preview ${file.originalName}`}
                    onClick={() => setViewing(file)}
                  >
                    {file.originalName}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.fileSizeBytes)} · attached{' '}
                    {format(file.createdAt, 'd MMM yyyy')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    title="Save a copy…"
                    disabled={busy}
                    onClick={() => void handleSaveCopy(file)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                  </Button>
                  {!isDeleted && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-8 px-2 ${confirming ? 'text-destructive' : ''}`}
                      title={confirming ? 'Click again to remove' : 'Remove'}
                      disabled={busy}
                      onClick={() => void handleRemove(file)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {confirmRemoveId && (
        <p className="text-xs text-destructive">
          Click the remove icon again to take that file off this photo.
        </p>
      )}

      {/* In-app viewer: renders straight from the stored bytes — nothing is
          written to disk, so no duplicate files pile up in Downloads. */}
      <ResultFileViewer
        file={viewing}
        onClose={() => setViewing(null)}
        onSaveCopy={(file) => void handleSaveCopy(file)}
        isSavingCopy={viewing !== null && busyId === viewing.id}
      />
    </div>
  );
}
