/**
 * EmptyState
 *
 * Single shared composition for empty / error / placeholder states.
 * Replaces the copy-pasted `w-16 h-16 rounded-full bg-muted` blocks.
 *
 * Restraint over decoration — clinical context.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Visual tone — controls icon container color. Defaults to muted. */
  tone?: 'muted' | 'destructive';
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = 'muted',
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'flex size-14 items-center justify-center rounded-full mb-4',
            tone === 'destructive'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-6" />
        </div>
      )}
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
