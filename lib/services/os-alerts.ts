/**
 * OS-level alert toasts for clinical attention items.
 *
 * Fires ONE aggregate, patient-free notification when an alerting item the
 * app hasn't surfaced before appears, and only when the user isn't already
 * looking at the app (the in-app badges cover the focused case). The last
 * snapshot of alerting ids lives in localStorage — ids only (kind:patientId),
 * never clinical content, and it stays on this device. The first ever run
 * seeds silently so an install or upgrade doesn't burst-toast.
 *
 * Everything is failure-tolerant: in the plain-browser preview (no Tauri
 * plugin) this module is a no-op, and a failed toast never throws — the
 * in-app dashboard remains the source of truth.
 */
import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { AttentionItem } from '@/lib/services/notification-service';
import { summariseForOsAlerts } from '@/lib/utils/os-alert-summary';

const SEEN_KEY = 'camog.osAlerts.seenIdsV1';

/**
 * Tray counters: push the current clinical-alert summary to the Rust shell
 * so the tray tooltip + menu line always match the dashboard badges. Runs
 * on every attention refresh (boot, mutations, 60 s poll) regardless of
 * focus/dedupe — the tray must stay truthful even when toasts are quiet.
 * The plain-browser preview has no tray: invoke fails and is swallowed.
 */
export function pushTraySummary(items: AttentionItem[]): void {
  const summary = summariseForOsAlerts(items);
  void invoke('update_tray_summary', {
    summary: summary ? summary.body : '',
  }).catch(() => {});
}

/** One useNotifications instance polls every 60 s and several components
 *  run one; without this guard two concurrent refreshes could both pass the
 *  seen-check and double-toast. */
let inFlight = false;

function loadSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked — alerts may re-fire; never fatal
  }
}

async function fire(title: string, body: string): Promise<void> {
  let granted = false;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
  } catch {
    return; // plugin unavailable (plain browser) — nothing to do
  }
  if (!granted) return;
  try {
    await sendNotification({ title, body });
  } catch {
    // notification centre unavailable — in-app badges still carry it
  }
}

/**
 * Called by useNotifications whenever a fresh attention list lands.
 * Never throws.
 */
export async function maybeFireOsAlerts(items: AttentionItem[]): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    if (typeof window === 'undefined') return;
    const summary = summariseForOsAlerts(items);

    // Baseline: remember what exists today without a toast storm.
    if (localStorage.getItem(SEEN_KEY) === null) {
      saveSeenIds(summary ? summary.ids : []);
      return;
    }

    const seen = loadSeenIds();
    const hasNew = summary !== null && summary.ids.some((id) => !seen.has(id));
    // Snapshot the current set regardless: cleared items drop out, so they
    // can re-alert later if they recur.
    saveSeenIds(summary ? summary.ids : []);
    if (!hasNew || !summary) return;

    // User is already looking at the app — the badges said it first.
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    await fire(summary.title, summary.body);
  } catch {
    // alerts are cosmetic on top of the in-app dashboard; never fatal
  } finally {
    inFlight = false;
  }
}
