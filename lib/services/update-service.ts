/**
 * Update service — the signed auto-update channel (specs/006).
 *
 * Windows-only by design: the updater endpoints and public key live in
 * tauri.windows.conf.json and the signed artifacts are produced by CI, so
 * other platforms simply have no channel yet (macOS stays manual until its
 * builds are signed and notarised). The service only ever OFFERS an update —
 * the download, signature verification and install always run on the user's
 * click, and the relaunch is a second explicit choice.
 */

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';

/** At most one automatic manifest check per day, per machine. */
const LAST_CHECK_KEY = 'camog.update.lastCheckMs';
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function updatesSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined &&
    /Windows/.test(navigator.userAgent)
  );
}

/** Store-managed installs never run the updater: the Store updates them. */
export async function storeManagedInstall(): Promise<boolean> {
  const allowed = await invoke<boolean>('updater_allowed').catch(() => false);
  return !allowed;
}

/** Ask the update channel whether a new version exists. Null means none (or
 * no channel on this install — callers treat that as "up to date"). */
export async function checkForUpdate(): Promise<Update | null> {
  if (!updatesSupported()) return null;
  if (await storeManagedInstall()) return null;
  return (await check()) ?? null;
}

/** The app's own version (CARGO_PKG_VERSION), null outside Tauri. */
export async function currentVersion(): Promise<string | null> {
  if (
    typeof window === 'undefined' ||
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined
  ) {
    return null;
  }
  return getVersion().catch(() => null);
}

export interface InstallProgress {
  /** 0–100, or null while the total size is unknown. */
  percent: number | null;
}

/** Download, verify the signature and stage the update. Never launches it —
 * the caller asks before relaunching. */
export async function installUpdate(
  update: Update,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  let total: number | null = null;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
      received = 0;
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength ?? 0;
    } else if (event.event === 'Finished') {
      received = total ?? received;
    }
    onProgress?.({
      percent: total ? Math.min(100, Math.round((received / total) * 100)) : null,
    });
  });
}

/** The shared install flow with progress + restart toast, used by the
 * Settings card and the launch toast's Install action alike. */
export async function installWithProgress(update: Update): Promise<void> {
  const id = toast.loading('Downloading the update…');
  try {
    await installUpdate(update, ({ percent }) => {
      toast.loading(
        percent == null ? 'Downloading the update…' : `Downloading the update… ${percent}%`,
        { id },
      );
    });
    toast.success('Update downloaded. Restart Camog to finish installing it.', {
      id,
      duration: Infinity,
      action: { label: 'Restart now', onClick: () => void relaunch() },
    });
  } catch (err) {
    toast.error('Could not install the update.', {
      id,
      description: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Toast the offer. Installation only ever happens through the action's
 * click — an update is a question, never a background change. */
export function offerUpdate(update: Update): void {
  toast.info(`Camog ${update.version} is available`, {
    description: update.body?.trim() || 'A new version is ready to install.',
    duration: Infinity,
    action: { label: 'Install', onClick: () => void installWithProgress(update) },
  });
}

/** Launch-time automatic check: at most once a day, silent unless there is
 * something to offer. Failures stay quiet (offline launches are normal). */
export async function maybeAutoCheckUpdate(): Promise<void> {
  if (!updatesSupported()) return;
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
    if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // private mode: the check itself is harmless, run it
  }
  const update = await checkForUpdate().catch(() => null);
  if (update) offerUpdate(update);
}
