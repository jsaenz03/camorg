/**
 * ConsentBadge Component
 *
 * Flags a patient whose photo consent is missing or expired, for the patients
 * list (grid card + table row). Same derived status and labelling as the
 * patient's timeline page badge, so the gap is visible before anyone opens
 * the record or captures. Renders nothing while consent is valid.
 */

'use client';

import { ShieldAlert } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { consentStatus } from '@/types/patient';
import { Badge } from '@/components/ui/badge';

export function ConsentBadge({ patient }: { patient: Patient }) {
  const consent = consentStatus(patient);
  if (consent === 'valid') return null;
  return (
    <Badge
      variant="outline"
      className="gap-1 border-destructive/40 text-destructive"
      title={
        consent === 'expired'
          ? 'Photo consent has expired — record new consent in Edit details'
          : 'No photo consent on record — add one in Edit details'
      }
    >
      <ShieldAlert className="size-3" />
      {consent === 'expired' ? 'Consent expired' : 'No consent'}
    </Badge>
  );
}
