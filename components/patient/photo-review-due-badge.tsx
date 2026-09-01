/**
 * PhotoReviewDueBadge
 *
 * Compact counter for a patient's photos whose scheduled review is coming up
 * or overdue — the per-photo counterpart of ReviewBadge. Renders nothing when
 * nothing is due. Red once any review is overdue, amber while merely upcoming,
 * matching the alarm-clock cues on photo tiles and the dashboard alerts.
 */

'use client';

import { AlarmClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Per-patient counts of photos with a scheduled review that is due soon or overdue. */
export interface DueReviewCounts {
  due: number;
  overdue: number;
}

interface PhotoReviewDueBadgeProps {
  due: number;
  overdue: number;
  className?: string;
}

export function PhotoReviewDueBadge({ due, overdue, className }: PhotoReviewDueBadgeProps) {
  if (due <= 0) return null;
  const hasOverdue = overdue > 0;
  return (
    <Badge
      variant={hasOverdue ? 'destructive' : 'outline'}
      className={cn(
        'min-w-0 gap-1 max-w-full',
        !hasOverdue && 'border-amber-500/50 text-amber-600 dark:text-amber-400',
        className,
      )}
      title="Photos with a review coming up or past due — flagged with an alarm clock on their tiles"
    >
      <AlarmClock className="size-3 shrink-0" />
      <span className="truncate">
        {due} {due === 1 ? 'photo' : 'photos'} due for review
        {hasOverdue ? ` · ${overdue} overdue` : ''}
      </span>
    </Badge>
  );
}
