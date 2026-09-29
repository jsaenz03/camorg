/**
 * useNotifications Hook
 *
 * Loads the attention list (review due/overdue/stale, expired consent,
 * pending signups) and keeps it fresh: a 60 s poll plus an immediate
 * refetch when a review-affecting action fires the change event.
 * Sidebar badges need only `counts`; the dashboard panel also takes
 * `items`. Errors resolve to empty state rather than throwing — the
 * plain-browser preview has no database at all.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useNotifications(): UseNotificationsReturn {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Monotonic seq so a slow poll can't overwrite a newer refresh.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const list = await notificationService.getAttentionItems();
      if (seq !== seqRef.current) return;
      setItems(list);
      pushTraySummary(list);
      void maybeFireOsAlerts(list);
    } catch {
      if (seq !== seqRef.current) return;
      setItems([]);
    } finally {
      if (seq === seqRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    window.addEventListener(ATTENTION_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener(ATTENTION_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return { counts: countsFromItems(items), items, isLoading, refresh };
}
