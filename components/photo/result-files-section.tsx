/**
 * ResultFilesSection
 *
 * Per-photo attachments: pathology reports, referral letters — any document
 * the clinician wants filed against this specific photo. Uploads copy the
 * picked file into {photosDir}/results (resultFileService); clicking a file
 * opens it in an in-app preview (no copy written to disk), and "Save a copy"
 * is there for formats the viewer can't render or when the clinician wants
 * the file outside Camog. Remove is a two-step soft delete. Deleted photos
 * show their files read-only.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
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
import {
  RESULT_FILE_DIALOG_FILTER,
  resultFilePreviewKind,
} from '@/types/result-file';
import { resultFileService } from '@/lib/services/result-file-service';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Blob URL from raw bytes: the webviews' PDF viewers render blob: frames
 *  reliably where base64 data: URLs come up blank, and this skips building
 *  a 4/3-size base64 string for a multi-MB PDF. */
function bytesToBlobUrl(bytes: Uint8Array<ArrayBuffer>, mime: string): string {
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
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

  // In-app preview state: the file being viewed + its loaded content.
  // ('none' preview kinds never reach state — the dialog shows its fallback
  // panel off resultFilePreviewKind while preview is still null.)
  const [viewing, setViewing] = useState<ResultFileRecord | null>(null);
  const [preview, setPreview] = useState<
    { kind: 'pdf' | 'image'; url: string } | { kind: 'text'; text: string } | null
  >(null);
  // The preview's blob URL, so it can be revoked when replaced or closed.
  const objectUrlRef = useRef<string | null>(null);
  // Bumped on every view/close: a readFileBytes that lands after its caller
  // was superseded must not write stale content into the dialog.
  const viewSeqRef = useRef(0);

  // Unmount (photo dialog closed) must release the previewed file's bytes —
  // an unreleased blob URL pins them for the life of the webview.
  useEffect(
    () => () => {
      viewSeqRef.current++;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    },
    [],
  );

  function revokeObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

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
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusyId(null);
      setConfirmRemoveId(null);
    }
  }

  /** Read the file in place and stage content for the preview dialog. */
  async function handleView(file: ResultFileRecord) {
    const seq = ++viewSeqRef.current;
    revokeObjectUrl();
    setViewing(file);
    setPreview(null);
    const kind = resultFilePreviewKind(file.originalName);
    if (kind === 'none') return; // fallback panel shows immediately
    try {
      const { bytes, mimeType } = await resultFileService.readFileBytes(file.id);
      if (seq !== viewSeqRef.current) return; // superseded by a close or newer view
      if (kind === 'text') {
        setPreview({ kind: 'text', text: new TextDecoder().decode(bytes) });
      } else {
        const url = bytesToBlobUrl(bytes, mimeType);
        objectUrlRef.current = url;
        setPreview({ kind, url });
      }
    } catch (err) {
      if (seq !== viewSeqRef.current) return;
      toast.error(errorText(err));
      setViewing(null);
    }
  }

  function closePreview() {
    viewSeqRef.current++;
    setViewing(null);
    setPreview(null);
    revokeObjectUrl();
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
                    onClick={() => void handleView(file)}
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

      {/* In-app preview: renders straight from the stored bytes — nothing is
          written to disk, so no duplicate files pile up in Downloads. */}
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && closePreview()}>
        <DialogContent className="flex h-[90dvh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <DialogTitle className="truncate pr-8 text-base" title={viewing?.originalName}>
              {viewing?.originalName}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Preview of an attached result file
            </DialogDescription>
          </DialogHeader>

          <div className="relative min-h-0 flex-1">
            {preview === null ? (
              viewing && resultFilePreviewKind(viewing.originalName) !== 'none' ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <FileText className="size-10 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    No in-app preview for this file type
                  </p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    PDFs, images and text files preview here. For this format,
                    save a copy and open it with your usual app.
                  </p>
                </div>
              )
            ) : preview.kind === 'text' ? (
              <pre className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs sm:p-6">
                {preview.text}
              </pre>
            ) : preview.kind === 'image' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/95 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- local file bytes as data URL */}
                <img
                  src={preview.url}
                  alt={`Preview of ${viewing?.originalName}`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <iframe
                src={preview.url}
                title={`Preview of ${viewing?.originalName}`}
                className="absolute inset-0 h-full w-full border-0 bg-white"
              />
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 sm:px-6">
            <p className="truncate text-xs text-muted-foreground">
              {viewing &&
                `${formatBytes(viewing.fileSizeBytes)} · attached ${format(viewing.createdAt, 'd MMM yyyy')}`}
            </p>
            {viewing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyId === viewing.id}
                onClick={() => void handleSaveCopy(viewing)}
              >
                <Download className="size-4" />
                Save a copy…
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
