'use client';

/**
 * UpdatesCard — the signed auto-update channel's manual surface (specs/006).
 *
 * Lives in Settings → Diagnostics (visible to every user: currency of the
 * app is a whole-machine concern, not an admin one). "Check for updates"
 * asks the channel on demand; an available version downloads, verifies its
 * signature and installs only on a second click, and the restart is a third.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  checkForUpdate,
  currentVersion,
  installWithProgress,
  storeManagedInstall,
  updatesSupported,
} from '@/lib/services/update-service';

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'offer'; update: Update };

export function UpdatesCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [storeManaged, setStoreManaged] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    setSupported(updatesSupported());
    if (!updatesSupported()) return;
    void currentVersion().then(setVersion);
    void storeManagedInstall().then(setStoreManaged);
  }, []);

  const check = useCallback(async () => {
    if (!supported || storeManaged) return;
    setStatus({ kind: 'checking' });
    try {
      const update = await checkForUpdate();
      setStatus(update ? { kind: 'offer', update } : { kind: 'up-to-date' });
    } catch (err) {
      setStatus({
        kind: 'unavailable',
        detail: err instanceof Error ? err.message : 'Could not reach the update channel.',
      });
    }
  }, [supported, storeManaged]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          Camog checks a signed update channel — new versions are verified
          against the publisher&apos;s key before they install, and always with
          your say-so.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {version && (
            <>
              This machine runs Camog {version}.{' '}
            </>
          )}
          {!supported ? (
            <>Automatic updates are available on Windows — this installation updates manually.</>
          ) : storeManaged ? (
            <>This copy came from the Microsoft Store, so the Store keeps it up to date.</>
          ) : status.kind === 'checking' ? (
            <>
              <Loader2 className="mr-1 inline size-4 animate-spin" /> Checking for updates…
            </>
          ) : status.kind === 'up-to-date' ? (
            <>Camog is up to date.</>
          ) : status.kind === 'offer' ? (
            <>
              Camog {status.update.version} is available.
            </>
          ) : status.kind === 'unavailable' ? (
            <>Could not check for updates: {status.detail}</>
          ) : (
            <>
              Automatic checks run at most once a day when Camog starts.
            </>
          )}
        </p>
        {supported && !storeManaged && status.kind === 'offer' && (
          <Button onClick={() => void installWithProgress(status.update)}>
            Download and install {status.update.version}
          </Button>
        )}
        {supported && !storeManaged && status.kind !== 'offer' && (
          <Button variant="outline" onClick={() => void check()} disabled={status.kind === 'checking'}>
            {status.kind === 'checking' ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 size-4" aria-hidden /> Check for updates
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
