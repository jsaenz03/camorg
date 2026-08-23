'use client';

/**
 * LicenceBanner — thin status bar above the dashboard header.
 *
 * trial → days left; valid + ≤30 days to expiry → renewal notice;
 * read-only → activation prompt. Valid licences well away from expiry
 * render nothing.
 */

import { format } from 'date-fns';
import { BadgeCheck, ShieldAlert, Timer } from 'lucide-react';
import { useLicence } from '@/lib/licence/licence-context';
import { Button } from '@/components/ui/button';

const MS_PER_DAY = 86_400_000;
const RENEWAL_WINDOW_DAYS = 30;

export function LicenceBanner() {
  const { status, loading, openActivation } = useLicence();
  if (loading || !status) return null;

  if (status.state === 'trial') {
    const daysLeft = Math.max(
      0,
      Math.ceil(((status.trialEndsAt?.getTime() ?? 0) - Date.now()) / MS_PER_DAY)
    );
    return (
      <div className="flex items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-1.5 text-sm text-primary">
        <Timer className="size-4" />
        <span>
          Trial — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </span>
        <Button size="sm" variant="secondary" className="h-7" onClick={openActivation}>
          Activate
        </Button>
      </div>
    );
  }

  if (status.state === 'read-only') {
    return (
      <div className="flex items-center justify-center gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-1.5 text-sm text-destructive">
        <ShieldAlert className="size-4" />
        <span>
          Read-only mode — existing records stay viewable.
          {status.licence
            ? ` Licence expired ${format(status.licence.expiresAt, 'd/MM/yyyy')}.`
            : ' Trial has ended.'}
        </span>
        <Button size="sm" variant="secondary" className="h-7" onClick={openActivation}>
          Activate
        </Button>
      </div>
    );
  }

  const expiresAt = status.licence?.expiresAt;
  if (expiresAt && expiresAt.getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * MS_PER_DAY) {
    return (
      <div className="flex items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-1.5 text-sm text-primary">
        <BadgeCheck className="size-4" />
        <span>Licence expires {format(expiresAt, 'd/MM/yyyy')} — renew to stay activated.</span>
        <Button size="sm" variant="secondary" className="h-7" onClick={openActivation}>
          Renew
        </Button>
      </div>
    );
  }

  return null;
}
