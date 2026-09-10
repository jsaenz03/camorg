'use client';

/**
 * ImportPhotosDialog — bulk-import existing image files from disk into one
 * patient's library. The adoption path for practices migrating folders of
 * historical photos: pick files → assign patient/body part → import.
 *
 * Reuses photoService.createPhoto per file, so the licence guard, by-doctor
 * access, auto-compress preference, encryption, thumbnails, recount and
 * per-photo audit all apply exactly as they do to camera captures. Files
 * already imported (same original file name for this patient) are skipped,
 * which makes re-running the same folder a no-op instead of a duplicate
 * batch. One extra 'photo.import' audit entry summarises the batch.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { join } from '@tauri-apps/api/path';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { readDir, readFile, stat } from '@tauri-apps/plugin-fs';
import { photoService } from '@/lib/services/photo-service';
import { auditService } from '@/lib/services/audit-service';
import { usePatients } from '@/lib/hooks/use-patients';
import { BODY_PARTS, BodyPartLabels } from '@/types/body-part';
import type { BodyPart } from '@/types/body-part';
import { LicenceReadOnlyError } from '@/lib/validators/errors';
import {
  IMPORT_MAX_BYTES,
  IMPORT_PICKER_EXTENSIONS,
  captureDateFor,
  classifyPickedFile,
  partitionByExisting,
} from '@/lib/photo/import-utils';
import type { ImportCandidate, ImportOptions } from '@/lib/photo/import-utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface ImportPhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once after a batch finishes with at least one import. */
  onImported?: () => void;
}

export function ImportPhotosDialog({ open, onOpenChange, onImported }: ImportPhotosDialogProps) {
  const { patients } = usePatients();
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [patientId, setPatientId] = useState('');
  const [bodyPart, setBodyPart] = useState<BodyPart | ''>('');
  const [dateMode, setDateMode] = useState<'file' | 'custom'>('file');
  const [customDate, setCustomDate] = useState('');
  const [phase, setPhase] = useState<'setup' | 'importing' | 'done'>('setup');
  const [imported, setImported] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [failed, setFailed] = useState<{ name: string; message: string }[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [licenceBlocked, setLicenceBlocked] = useState(false);

  // A fresh open starts over; results stay readable until the dialog closes.
  useEffect(() => {
    if (open) {
      setCandidates([]);
      setPatientId('');
      setBodyPart('');
      setDateMode('file');
      setCustomDate('');
      setPhase('setup');
      setImported(0);
      setBatchTotal(0);
      setFailed([]);
      setSkippedCount(0);
      setLicenceBlocked(false);
    }
  }, [open]);

  const importable = candidates.filter((c) => !c.tooLarge);
  const canImport =
    phase === 'setup' &&
    importable.length > 0 &&
    patientId !== '' &&
    (dateMode === 'file' || customDate !== '');

  async function pickFiles() {
    try {
      const picked = await openFileDialog({
        multiple: true,
        filters: [{ name: 'Images', extensions: IMPORT_PICKER_EXTENSIONS }],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      await classifyPaths(paths);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the file picker');
    }
  }

  /** "Point at a folder" mode: import every supported image at the folder's
   *  top level (nested folders are not walked — re-point at them separately).
   *  The dialog plugin adds the picked path to the fs runtime scope, so
   *  readDir/stat on it work under the app's fs permissions. */
  async function pickFolder() {
    try {
      const picked = await openFileDialog({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      const entries = await readDir(picked);
      const paths: string[] = [];
      for (const entry of entries) {
        if (entry.isFile) paths.push(await join(picked, entry.name));
      }
      if (paths.length === 0) {
        toast.info('No image files at the top level of that folder.');
        return;
      }
      await classifyPaths(paths);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the folder picker');
    }
  }

  /** Classify picked paths into candidates (or drop unsupported extensions). */
  async function classifyPaths(paths: string[]) {
    const next: ImportCandidate[] = [];
    for (const path of paths) {
      const info = await stat(path);
      // mtime is null on some filesystems; classifyPickedFile's clamp
      // turns a zero stamp into "now" at import time.
      const candidate = classifyPickedFile(path, {
        size: info.size,
        mtimeMs: info.mtime ? info.mtime.getTime() : 0,
      });
      if (candidate) next.push(candidate);
    }
    // Folder reads come back in filesystem order; names keep the list stable.
    next.sort((a, b) => a.name.localeCompare(b.name));
    setCandidates(next);
  }

  async function runImport() {
    if (patientId === '') return;
    setPhase('importing');
    setImported(0);
    setBatchTotal(importable.length);
    setFailed([]);
    setSkippedCount(0);
    setLicenceBlocked(false);

    const options: ImportOptions = {
      patientId,
      bodyPart: bodyPart === '' ? null : bodyPart,
      dateMode,
      customDateMs: dateMode === 'custom' && customDate ? new Date(`${customDate}T00:00:00`).getTime() : null,
    };

    const existing = await photoService.getImportedFileNames(patientId);
    const { fresh } = partitionByExisting(
      importable.map((c) => c.name),
      existing,
    );
    const freshSet = new Set(fresh);
    const toImport = importable.filter((c) => freshSet.has(c.name));
    setSkippedCount(importable.length - toImport.length);
    setBatchTotal(toImport.length);

    const failures: { name: string; message: string }[] = [];
    let ok = 0;
    for (const candidate of toImport) {
      try {
        const bytes = await readFile(candidate.path);
        const file = new File([bytes], candidate.name, {
          type: candidate.mimeType,
          lastModified: candidate.modifiedMs,
        });
        await photoService.createPhoto({
          patientId,
          imageBlob: file,
          mimeType: candidate.mimeType,
          bodyPart: bodyPart === '' ? null : bodyPart,
          capturedAt: new Date(captureDateFor(candidate, options)),
          originalFileName: candidate.name,
        });
        ok += 1;
        setImported(ok);
      } catch (err) {
        // A read-only install stops the batch — the guard has already opened
        // the activation dialog; failing every remaining file adds noise.
        if (err instanceof LicenceReadOnlyError) {
          setLicenceBlocked(true);
          break;
        }
        failures.push({
          name: candidate.name,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
        setFailed([...failures]);
      }
    }

    if (ok > 0) {
      void auditService.record('photo.import', {
        entityType: 'patient',
        entityId: patientId,
        patientId,
        detail: `imported ${ok} photo${ok === 1 ? '' : 's'} from disk`,
      });
      toast.success(`Imported ${ok} photo${ok === 1 ? '' : 's'}`);
      onImported?.();
    }
    setPhase('done');
  }

  const total = batchTotal || importable.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-4 text-primary" />
            Import photos
          </DialogTitle>
          <DialogDescription>
            Add existing image files from your computer to a patient&rsquo;s library.
            Each file&rsquo;s modified date is used as its capture date.
          </DialogDescription>
        </DialogHeader>

        {phase === 'setup' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => void pickFiles()}>
                  <FolderOpen className="size-4" />
                  Choose files…
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => void pickFolder()}>
                  <FolderOpen className="size-4" />
                  Choose folder…
                </Button>
              </div>
              {candidates.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {candidates.length} file{candidates.length === 1 ? '' : 's'} selected
                  {candidates.length - importable.length > 0 &&
                    ` · ${candidates.length - importable.length} over ${formatBytes(IMPORT_MAX_BYTES)} (excluded)`}
                </p>
              )}
              {candidates.length > 0 && (
                <ScrollArea className="h-40 rounded-md border p-2">
                  <ul className="space-y-1.5">
                    {candidates.map((c) => (
                      <li key={c.path} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate" title={c.name}>
                          {c.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(c.sizeBytes)} ·{' '}
                          {format(new Date(c.modifiedMs || Date.now()), 'd/MM/yyyy')}
                          {c.tooLarge && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-destructive">
                              <AlertTriangle className="size-3" />
                              too large
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Patient</label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Body part</label>
                <Select
                  value={bodyPart}
                  onValueChange={(v) => setBodyPart(v as BodyPart)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select body part" />
                  </SelectTrigger>
                  <SelectContent>
                    {BODY_PARTS.map((part) => (
                      <SelectItem key={part} value={part}>
                        {BodyPartLabels[part]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Optional — when set, it applies to every imported photo. Photos
              without one read as Unspecified until you tag them, or link them
              into a series and they take the other photo&rsquo;s location.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Capture date</label>
                <Select value={dateMode} onValueChange={(v) => setDateMode(v as 'file' | 'custom')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="file">Each file&rsquo;s modified date</SelectItem>
                    <SelectItem value="custom">One date for all</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {dateMode === 'custom' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Date</label>
                  <input
                    type="date"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                    value={customDate}
                    max={format(new Date(), 'yyyy-MM-dd')}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'importing' && (
          <div className="space-y-3 py-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Importing {imported} of {total}…
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${total === 0 ? 0 : Math.round((imported / total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-primary" />
              Imported {imported}
              {skippedCount > 0 && ` · skipped ${skippedCount} (already imported)`}
              {failed.length > 0 && ` · failed ${failed.length}`}
            </p>
            {licenceBlocked && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="size-4" />
                Import stopped — activate a licence to continue.
              </p>
            )}
            {failed.length > 0 && (
              <ScrollArea className="h-32 rounded-md border p-2">
                <ul className="space-y-1.5">
                  {failed.map((f) => (
                    <li key={f.name} className="text-xs">
                      <span className="font-medium">{f.name}</span>
                      <span className="text-muted-foreground"> — {f.message}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'setup' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!canImport} onClick={() => void runImport()}>
                <Upload className="size-4" />
                Import {importable.length} photo{importable.length === 1 ? '' : 's'}
              </Button>
            </>
          )}
          {phase === 'importing' && <Button disabled>Importing…</Button>}
          {phase === 'done' && (
            <>
              <Button variant="outline" onClick={() => setPhase('setup')}>
                Import more
              </Button>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
