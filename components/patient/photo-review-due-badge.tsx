/**
 * PhotoReviewDueBadge
 *
 * Compact counter for a patient's photos with a scheduled review — red once
 * any review is overdue, amber while merely upcoming, and a quiet muted pill
 * showing the next date when every review is still beyond the alert window
 * (so a review months out stays visible without sounding the alarm). Renders
 * nothing when no photo has a review scheduled. Matches the alarm-clock cues
 * on photo tiles and the dashboard alerts.
 */

'use client';

import { format } from 'date-fns';
import { AlarmClock, CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Per-patient counts of photos with a scheduled review (any distance). */
export interface DueReviewCounts {
  /** Due soon or overdue (includes the overdue count). */
  due: number;
  overdue: number;
  /** Scheduled but beyond the warning window — date shown, quiet colour. */
  scheduled: number;
  /** Earliest review date among the counted photos — how far off the next one is. */
  nextDueAt?: Date | null;
}

interface PhotoReviewDueBadgeProps {
  due: number;
  overdue: number;
  scheduled?: number;
  nextDueAt?: Date | null;
  className?: string;
}

export function PhotoReviewDueBadge({
  due,
  overdue,
  scheduled = 0,
  nextDueAt,
  className,
}: PhotoReviewDueBadgeProps) {
  if (due + scheduled <= 0) return null;
  const hasOverdue = overdue > 0;
  // Nothing urgent — every scheduled review is beyond the alert window.
  const scheduledOnly = due <= 0;
  return (
    <Badge
      variant={hasOverdue ? 'destructive' : 'outline'}
      className={cn(
        'min-w-0 gap-1 max-w-full',
        !hasOverdue && !scheduledOnly && 'border-amber-500/50 text-amber-600 dark:text-amber-400',
        scheduledOnly && 'text-muted-foreground',
        className,
      )}
      title={`Photos with a scheduled review${
        nextDueAt ? `. Earliest: ${format(nextDueAt, 'd MMM yyyy')}` : ''
      }`}
    >
      {scheduledOnly ? (
        <CalendarClock className="size-3 shrink-0" />
      ) : (
        <AlarmClock className="size-3 shrink-0" />
      )}
      <span className="truncate">
        {scheduledOnly
          ? `Next photo review${nextDueAt ? ` on ${format(nextDueAt, 'd MMM yyyy')}` : ''}`
          : `${due} ${due === 1 ? 'photo' : 'photos'} due for review${
              nextDueAt ? ` on ${format(nextDueAt, 'd MMM yyyy')}` : ''
            }${hasOverdue ? ` · ${overdue} overdue` : ''}`}
      </span>
    </Badge>
  );
}
