/**
 * PageHeader
 *
 * Shared top-of-page header. Standardizes title/description/optional action
 * layout and outer container margins across dashboard pages.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Status row (badges) rendered under the description, inside the metadata
   *  block — status is not action, so it never shares a row with the buttons
   *  and each side wraps without squeezing the other. */
  status?: React.ReactNode;
  /** Slot aligned to the trailing edge (buttons, badges). */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, status, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground sm:text-base">{description}</p>
        )}
        {status && <div className="flex flex-wrap items-center gap-2 pt-1">{status}</div>}
      </div>
      {/* Wrapping, shrinkable action row: shrink-0 here forced the full row's
          width onto the layout and squeezed the title column on tight or
          high-scale screens — buttons wrap to a second row instead. */}
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
