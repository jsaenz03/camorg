'use client';

/**
 * LicenceActivationDialog — the single activation surface, rendered once in
 * the root layout. Opened via useLicence().openActivation() from the banner,
 * the read-only gates, and Settings → Licence.
 */

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { licenceService } from '@/lib/services/licence-service';
import { useLicence } from '@/lib/licence/licence-context';
import { BuyLicenceLink } from '@/components/licence/buy-licence-link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export function LicenceActivationDialog() {
  const { status, refresh, activationOpen, closeActivation } = useLicence();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const next = await licenceService.activate(key);
      toast.success(`Licensed to ${next.licence?.practice ?? 'your practice'}`);
      setKey('');
      closeActivation();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={activationOpen} onOpenChange={(open) => !open && closeActivation()}>
      {/* Bounded dialog: header and action stay put, the key and help text
          scroll between them on short screens. */}
      <DialogContent className="flex max-h-[95dvh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            Activate Camog
          </DialogTitle>
          <DialogDescription>
            {status?.licence
              ? `Currently licensed to ${status.licence.practice} until ${format(status.licence.expiresAt, 'd/MM/yyyy')}. Activating confirms this device's seat — a one-time internet check.`
              : 'Paste the licence key you received by email. Activation needs a one-time internet connection.'}
          </DialogDescription>
        </DialogHeader>
        {/* Full-bleed scroll region — px-6 restores the dialog's inset. */}
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        <div className="space-y-3">
          <Textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste licence key…"
            rows={5}
            spellCheck={false}
            // field-sizing-content (the Textarea default) makes the textarea's
            // intrinsic width the full unbroken licence key, which overflows
            // the dialog grid. The named utility (not [field-sizing:fixed] —
            // it loses the cascade to field-sizing-content) lets tailwind-merge
            // drop the default; fixed sizing keeps it w-full and the key wraps.
            className="font-mono text-xs field-sizing-fixed"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && key.trim()) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Your licence covers one practice and the device seats it was issued with. Line breaks
            from email wrapping are fine.
          </p>
          <p className="text-xs text-muted-foreground">
            No key yet, or renewing? <BuyLicenceLink /> — checkout is on our website and the key
            arrives by email.
          </p>
        </div>
        </div>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button onClick={submit} disabled={submitting || !key.trim()} className="w-full">
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
