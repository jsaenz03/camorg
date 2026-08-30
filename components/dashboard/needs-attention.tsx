/**
 * NeedsAttention
 *
 * Dashboard panel listing everything that wants the clinician's eye:
 * overdue/upcoming reviews, stale patients, expired consent, and (for
 * admins) accounts awaiting approval. Items come from the notification
 * service via useNotifications; each row links to where the fix happens.
 */

'use client';

import Link from 'next/link';
import {
  AlarmClock,
  ArrowRight,
  CircleAlert,
  Hourglass,
  ShieldAlert,
  UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AttentionItem, AttentionKind } from '@/lib/services/notification-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  'review-overdue': CircleAlert,
  'review-due-soon': AlarmClock,
  'review-stale': Hourglass,
  'consent-expired': ShieldAlert,
  'signup-pending': UserPlus,
};

const SEVERITY_CLASS: Record<AttentionItem['severity'], string> = {
  critical: 'text-destructive bg-destructive/10',
  warning: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  info: 'text-muted-foreground bg-muted',
};

export function NeedsAttention({
  items,
  isLoading,
}: {
  items: AttentionItem[];
  isLoading: boolean;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Needs attention
        </CardTitle>
        {items.length > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {items.length}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="All caught up"
            description="No overdue reviews, stale patients, or expired consent."
          />
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                        SEVERITY_CLASS[item.severity],
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                    <ArrowRight className="mt-1.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
