'use client';

/**
 * LicencePanel — Settings → Licence (admin).
 *
 * Read-only view of the install's licence state plus the change-key entry
 * point (opens the shared activation dialog).
 */

import { format } from 'date-fns';
import { BadgeCheck, ShieldAlert, Timer } from 'lucide-react';
import { useLicence } from '@/lib/licence/licence-context';
import { licenceService } from '@/lib/services/licence-service';
import { BuyLicenceLink } from '@/components/licence/buy-licence-link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function LicencePanel() {
  const { status, loading, refresh, openActivation } = useLicence();

  // Optimism is safe: the write is a local settings row, and refresh() is
  // the truth. Failures surface via the toggle snapping back on re-read.
  const setAutoRenew = async (on: boolean) => {
    try {
      await licenceService.setAutoRenew(on);
    } finally {
      await refresh();
    }
  };

  if (loading || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Licence</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading licence state…</CardContent>
      </Card>
    );
  }

  const licence = status.licence;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status.state === 'valid' && <BadgeCheck className="size-5 text-primary" />}
          {status.state === 'trial' && <Timer className="size-5 text-primary" />}
          {status.state === 'read-only' && <ShieldAlert className="size-5 text-destructive" />}
          Licence
        </CardTitle>
        <CardDescription>
          {status.state === 'valid' && 'Camog is licensed on this machine.'}
          {status.state === 'trial' &&
            `Trial — ends ${status.trialEndsAt ? format(status.trialEndsAt, 'd/MM/yyyy') : 'soon'}.`}
          {status.state === 'read-only' &&
            'Read-only mode — capture and editing are disabled.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y">
          <Row label="Status">
            <Badge
              variant={status.state === 'read-only' ? 'destructive' : 'secondary'}
            >
              {status.state === 'valid'
                ? 'Licensed'
                : status.state === 'trial'
                  ? 'Trial'
                  : 'Read-only'}
            </Badge>
          </Row>
          {licence && (
            <>
              <Row label="Licensed to">{licence.practice}</Row>
              <Row label="Tier">
                {licence.tier.charAt(0).toUpperCase() + licence.tier.slice(1)}
              </Row>
              <Row label="Device seats">{licence.seats}</Row>
              <Row label="Expires">{format(licence.expiresAt, 'd/MM/yyyy')}</Row>
              <div className="flex items-start justify-between gap-4 py-1.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Auto-renew</p>
                  <p className="text-xs text-muted-foreground">
                    Installs a renewed licence by itself after each successful payment —
                    nothing to re-enter. Off means the emailed key is activated by hand.
                  </p>
                </div>
                <Switch
                  checked={status.autoRenew}
                  onCheckedChange={(on) => void setAutoRenew(on)}
                  aria-label="Auto-renew licence"
                />
              </div>
            </>
          )}
          <Row label="Device ID">
            <code className="font-mono text-xs">{status.installId}</code>
          </Row>
        </div>
        <Button onClick={openActivation}>
          {licence ? 'Change licence key' : 'Activate Camog'}
        </Button>
        <p className="text-xs text-muted-foreground">
          No key yet, or renewing? <BuyLicenceLink /> — checkout is on our website and the key
          arrives by email.
        </p>
      </CardContent>
    </Card>
  );
}
