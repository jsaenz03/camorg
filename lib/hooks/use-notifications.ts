/**
 * useNotifications Hook
 *
 * Loads the attention list (review due/overdue/stale, expired consent,
 * pending signups) and keeps it fresh: a 60 s poll plus an immediate
 * refetch when a review-affecting action fires the change event.
 * Sidebar badges need only `counts`; the dashboard panel also takes
 * `items`. Errors resolve to empty state rather than throwing — the
 * plain-browser preview has no database at all.
 *
 * The poller is a module-level singleton: two components mount this hook
 * (sidebar badge + dashboard panel), and independent instances used to
 * double the 60 s query set and every event-driven refetch. All mounted
 * hooks share one interval and one latest result.
 */

'use client';

import { useEffect, useState } from 'react';
import type { AttentionItem, NotificationCounts } from '@/lib/services/notification-service';
import {
  ATTENTION_CHANGED_EVENT,
  countsFromItems,
  notificationService,
} from '@/lib/services/notification-service';
// Side channel: the tray counters (always) and one aggregate OS toast when
// a new clinical alert appears while the window is hidden/unfocused —
// patient-free text, deduped inside.
import { maybeFireOsAlerts, pushTraySummary } from '@/lib/services/os-alerts';

const POLL_MS = 60_000;

interface UseNotificationsReturn {
  counts: NotificationCounts | null;
  items: AttentionItem[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

type Listener = (items: AttentionItem[], isLoading: boolean) => void;

const listeners = new Set<Listener>();
let currentItems: AttentionItem[] = [];
let currentLoading = true;
let loadedOnce = false;
let poller: ReturnType<typeof setInterval> | null = null;
// Monotonic seq so a slow refresh can't overwrite a newer one.
let seq = 0;

const onAttentionChanged = () => void runRefresh();

function notify(): void {
  for (const listener of listeners) listener(currentItems, currentLoading);
}

async function runRefresh(): Promise<void> {
  const mySeq = ++seq;
  try {
    const list = await notificationService.getAttentionItems();
    if (mySeq !== seq) return;
    currentItems = list;
    pushTraySummary(list);
    void maybeFireOsAlerts(list);
  } catch {
    if (mySeq !== seq) return;
    currentItems = [];
  } finally {
    if (mySeq === seq) {
      loadedOnce = true;
      currentLoading = false;
      notify();
    }
  }
}

function ensurePoller(): void {
  if (poller !== null) return;
  poller = setInterval(() => void runRefresh(), POLL_MS);
  window.addEventListener(ATTENTION_CHANGED_EVENT, onAttentionChanged);
}

function releasePoller(): void {
  if (listeners.size > 0 || poller === null) return;
  clearInterval(poller);
  poller = null;
  window.removeEventListener(ATTENTION_CHANGED_EVENT, onAttentionChanged);
}

/**
 * Logout hygiene: the singleton state outlives SPA navigation, so without
 * this the next clinician's first render would show the previous session's
 * attention items (they carry patient names) — and skip the mount-time
 * refetch because loadedOnce is still true. auth-service logout calls this.
 */
export function resetNotificationsState(): void {
  // Any in-flight refresh from the old session discards itself on the seq
  // check instead of overwriting the reset.
  seq++;
  currentItems = [];
  currentLoading = true;
  loadedOnce = false;
  notify();
}

export function useNotifications(): UseNotificationsReturn {
  const [state, setState] = useState<{ items: AttentionItem[]; isLoading: boolean }>(() => ({
    items: currentItems,
    isLoading: currentLoading,
  }));

  useEffect(() => {
    const listener: Listener = (items, isLoading) => setState({ items, isLoading });
    listeners.add(listener);
    ensurePoller();
    // Only the first-ever mount fetches immediately; later mounts join the
    // existing cycle (their data is at most one poll old, as on the dashboard).
    if (!loadedOnce) void runRefresh();
    return () => {
      listeners.delete(listener);
      releasePoller();
    };
  }, []);

  return {
    counts: countsFromItems(state.items),
    items: state.items,
    isLoading: state.isLoading,
    refresh: runRefresh,
  };
}
