/**
 * ReviewBadge
 *
 * Compact derived-status pill for a patient's review schedule: overdue,
 * due soon, scheduled, or stale (photos but no review for a long while).
 * Renders nothing when there's nothing to flag. Windows come from the
 * branding/settings provider so every surface agrees with the dashboard.
 */

'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { AlarmClock, CalendarClock, CircleAlert, Hourglass } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { reviewStatus } from '@/types/patient';
import { useBranding } from '@/components/branding-boot';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ReviewBadgeProps {
  patient: Pick<Patient, 'reviewDueAt' | 'lastReviewedAt' | 'lastPhotoAt' | 'photoCount'>;
  className?: string;
}

export function ReviewBadge({ patient, className }: ReviewBadgeProps) {
  const { reviewWarningDays, reviewStaleDays } = useBranding();
  const status = reviewStatus(patient, {
    warningDays: reviewWarningDays,
    staleDays: reviewStaleDays,
  });
  if (status === 'none') return null;

  const due = patient.reviewDueAt
    ? format(patient.reviewDueAt, 'd MMM yyyy')
    : null;

  const shared = 'gap-1';
  switch (status) {
    case 'overdue':
      return (
        <Badge variant="destructive" className={cn(shared, className)}>
          <CircleAlert className="size-3" />
          Review overdue{due ? ` · was due ${due}` : ''}
        </Badge>
      );
    case 'due-soon':
      return (
        <Badge
          variant="outline"
          className={cn(shared, 'border-amber-500/50 text-amber-600 dark:text-amber-400', className)}
        >
          <AlarmClock className="size-3" />
          Review {due ? `due ${due}` : 'due'}
        </Badge>
      );
    case 'scheduled':
      return (
        <Badge variant="outline" className={cn(shared, 'text-muted-foreground', className)}>
          <CalendarClock className="size-3" />
          Review {due}
        </Badge>
      );
    case 'stale': {
      const last = patient.lastReviewedAt ?? patient.lastPhotoAt;
      return (
        <Badge variant="secondary" className={cn(shared, className)}>
          <Hourglass className="size-3" />
          Not reviewed{' '}
          {last ? `for ${formatDistanceToNow(last, { addSuffix: false })}` : 'recently'}
        </Badge>
      );
    }
  }
}
