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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            Activate Camog
          </DialogTitle>
          <DialogDescription>
            {status?.licence
              ? `Currently licensed to ${status.licence.practice} until ${format(status.licence.expiresAt, 'd/MM/yyyy')}.`
              : 'Paste the licence key you received by email.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste licence key…"
            rows={5}
            spellCheck={false}
            // field-sizing-content (the Textarea default) makes the textarea's
            // intrinsic width the full unbroken licence key, which overflows
            // the dialog grid. Fixed sizing keeps it w-full; the key wraps.
            className="font-mono text-xs [field-sizing:fixed]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && key.trim()) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Your licence covers one practice. Line breaks from email wrapping are fine.
          </p>
          <Button onClick={submit} disabled={submitting || !key.trim()} className="w-full">
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Activate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
