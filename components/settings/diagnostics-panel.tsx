'use client';

/**
 * Settings → Diagnostics. Shows what broke, when, and where: health checks
 * for the SQLite database and photos folder, the in-session event log from
 * the Rust ring buffer (command failures, panics, webview errors), and
 * support actions (copy a report, open the log folder). Available to every
 * clinician — anyone can hit a failure and need to report it. Entries stay
 * on this device.
 */

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { invoke } from '@tauri-apps/api/core';
import { ClipboardCopy, FolderOpen, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { getDB, getPhotosDir } from '@/lib/db/database';
import type { DiagnosticsInfo } from '@/lib/diagnostics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type CheckState = 'checking' | 'ok' | 'failed';

interface Health {
  db: CheckState;
  /** 'ok' + resolved path, or 'failed' + the error message. */
  photos: { state: CheckState; detail: string };
}

const initialHealth: Health = {
  db: 'checking',
  photos: { state: 'checking', detail: '' },
};

function buildReportText(info: DiagnosticsInfo, health: Health): string {
  const lines = [
    'Camog diagnostics',
    `Version: ${info.version}`,
    `System: ${info.os}`,
    `Log folder: ${info.logDir ?? 'unavailable'}`,
    `Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm:ss')}`,
    `Database: ${health.db === 'ok' ? 'reachable' : health.db === 'failed' ? 'unreachable' : 'unknown'}`,
    `Photos folder: ${health.photos.detail || 'unknown'}`,
    '',
    'Events (oldest first):',
    ...info.entries.map(
      (e) =>
        `${format(e.ts, 'dd/MM/yyyy HH:mm:ss')} [${e.level}] ${e.source}: ${e.message}` +
        (e.detail ? `\n    ${e.detail.replace(/\n/g, '\n    ')}` : ''),
    ),
  ];
  return lines.join('\n');
}

function CheckStateDot({ state }: { state: CheckState }) {
  const colour =
    state === 'ok' ? 'bg-green-500' : state === 'failed' ? 'bg-red-500' : 'bg-muted-foreground/40';
  return <span className={`inline-block size-2 rounded-full ${colour}`} aria-hidden />;
}

function LevelBadge({ level }: { level: string }) {
  if (level === 'error') return <Badge variant="destructive">error</Badge>;
  if (level === 'warn') return <Badge variant="outline" className="text-amber-600">warn</Badge>;
  return <Badge variant="secondary">info</Badge>;
}

interface ClearOutcome {
  logFilesCleared: number;
  logError: string | null;
}

/**
 * Hard confirmation for wiping diagnostics: the action deletes the session's
 * recorded events AND the log files on disk, so the user must type CLEAR
 * exactly before the destructive button enables.
 */
function ClearConfirmDialog({
  open,
  eventCount,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  eventCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  const confirmed = text.trim() === 'CLEAR';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clear all diagnostics?</DialogTitle>
          <DialogDescription>
            This permanently deletes the {eventCount} recorded{' '}
            {eventCount === 1 ? 'event' : 'events'} from this session and removes
            every Camog log file on disk (including rotated ones). This cannot
            be undone. Type <span className="font-semibold">CLEAR</span> to
            confirm.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed) onConfirm();
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type CLEAR"
            autoComplete="off"
            autoFocus
            aria-label="Type CLEAR to confirm"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmed}>
              Clear everything
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DiagnosticsPanel() {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [health, setHealth] = useState<Health>(initialHealth);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    setLoadFailed(false);
    setHealth(initialHealth);

    invoke<DiagnosticsInfo>('diagnostics_info')
      .then(setInfo)
      .catch(() => setLoadFailed(true));

    getDB()
      .then(() => setHealth((h) => ({ ...h, db: 'ok' })))
      .catch(() => setHealth((h) => ({ ...h, db: 'failed' })));

    getPhotosDir()
      .then((dir) => setHealth((h) => ({ ...h, photos: { state: 'ok', detail: dir } })))
      .catch((err) =>
        setHealth((h) => ({
          ...h,
          photos: {
            state: 'failed',
            detail: err instanceof Error ? err.message : String(err),
          },
        })),
      );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function copyReport() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(buildReportText(info, health));
      toast.success('Diagnostics copied to the clipboard');
    } catch {
      toast.error('Could not copy — the clipboard was unavailable');
    }
  }

  async function openLogFolder() {
    if (!info?.logDir) {
      toast.error('Log folder location is unavailable');
      return;
    }
    invoke('reveal_saved_report', { path: info.logDir }).catch((e: unknown) =>
      toast.error(String(e)),
    );
  }

  async function clear() {
    try {
      const outcome = await invoke<ClearOutcome>('diagnostics_clear');
      setConfirmClear(false);
      if (outcome.logError) {
        toast.warning(
          `Session events cleared, but a log file could not be removed (${outcome.logError}). The rest of the log history may still be on disk.`,
        );
      } else {
        toast.success('Diagnostics cleared — session events and log files removed');
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear diagnostics');
    }
  }

  const entries = info ? [...info.entries].reverse() : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="size-4" /> Diagnostics
        </CardTitle>
        <CardDescription>
          What broke, when, and where — captured automatically from app errors.
          Entries stay on this device; copy them for support. Full history also
          lives in the log file — Clear removes both.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Environment + health */}
        {info === null && !loadFailed ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : loadFailed ? (
          <p className="text-sm text-red-600">
            Diagnostics are unavailable — the app backend did not respond.
          </p>
        ) : (
          info && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckStateDot state={health.db} />
                <span>Database</span>
                <span className="text-muted-foreground">
                  {health.db === 'ok'
                    ? 'reachable'
                    : health.db === 'failed'
                      ? 'unreachable — restart the app'
                      : 'checking…'}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <CheckStateDot state={health.photos.state} />
                <span className="shrink-0">Photos folder</span>
                <span className="break-all text-muted-foreground">
                  {health.photos.state === 'checking'
                    ? 'checking…'
                    : health.photos.detail}
                </span>
              </div>
              <p className="text-muted-foreground">
                Camog v{info.version} · {info.os}
                {info.logDir && (
                  <>
                    {' '}
                    · logs at{' '}
                    <span className="break-all font-mono text-xs">{info.logDir}</span>
                  </>
                )}
              </p>
            </div>
          )
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyReport()} disabled={!info}>
            <ClipboardCopy /> Copy for support
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openLogFolder()}
            disabled={!info?.logDir}
          >
            <FolderOpen /> Open log folder
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 /> Clear
          </Button>
        </div>

        <ClearConfirmDialog
          open={confirmClear}
          eventCount={entries.length}
          onOpenChange={setConfirmClear}
          onConfirm={() => void clear()}
        />

        {/* Event log */}
        {entries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nothing recorded this session — errors and warnings will appear here
            as they happen.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Level</th>
                  <th className="py-2 pr-4 font-medium">From</th>
                  <th className="py-2 font-medium">What happened</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.ts + entry.source + entry.message} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums">
                      {format(entry.ts, 'dd/MM/yyyy HH:mm:ss')}
                    </td>
                    <td className="py-2 pr-4">
                      <LevelBadge level={entry.level} />
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{entry.source}</td>
                    <td
                      className="max-w-72 truncate py-2"
                      title={entry.detail ?? entry.message}
                    >
                      {entry.message}
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
