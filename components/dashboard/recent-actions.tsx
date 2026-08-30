/**
 * RecentActions
 *
 * Compact activity feed for the dashboard, straight off the audit log.
 * Admins see the whole org's trail; clinicians see their own actions
 * (auditService.list(scope:'mine')). Refetches when a review-affecting
 * action fires the attention-change event.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import type { AuditEntry } from '@/types/audit';
import { AuditActionLabels } from '@/types/audit';
import { auditService } from '@/lib/services/audit-service';
import { ATTENTION_CHANGED_EVENT } from '@/lib/services/notification-service';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/utils/date-formatting';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const LIMIT = 8;

export function RecentActions() {
  const { clinician } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isAdmin = clinician?.role === 'admin';

  const refresh = useCallback(() => {
    auditService
      .list({ limit: LIMIT, scope: isAdmin ? 'all' : 'mine' })
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setIsLoading(false));
  }, [isAdmin]);

  useEffect(() => {
    refresh();
    window.addEventListener(ATTENTION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ATTENTION_CHANGED_EVENT, refresh);
  }, [refresh]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent actions
        </CardTitle>
        <History className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No activity recorded yet.
          </p>
        ) : (
          <ul className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{AuditActionLabels[entry.action] ?? entry.action}</span>
                  {isAdmin && entry.clinicianName && (
                    <span className="text-muted-foreground"> · {entry.clinicianName}</span>
                  )}
                  {entry.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.detail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            Full history in{' '}
            <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
              Settings → Audit log
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
