/**
 * RecordConsentDialog Component
 *
 * Focused, one-purpose dialog for recording a patient's photo consent:
 * scope + optional expiry, consent given as of now. Opened from everywhere
 * the "no consent" warning appears — the capture flow's post-save prompt,
 * the timeline's consent banner, and after an upload batch — so the fix is
 * one click away from the warning instead of buried in Edit details.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { ConsentScope, Patient } from '@/types/patient';
import { ConsentScopeLabels, consentStatus } from '@/types/patient';
import { patientService } from '@/lib/services/patient-service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RecordConsentDialogProps {
  patient: Patient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the updated patient after consent is recorded. */
  onSaved?: (patient: Patient) => void;
}

export function RecordConsentDialog({
  patient,
  open,
  onOpenChange,
  onSaved,
}: RecordConsentDialogProps) {
  const isRenewal = consentStatus(patient) === 'expired';
  const [scope, setScope] = useState<ConsentScope>(patient.consentScope ?? 'care');
  const [expiresAt, setExpiresAt] = useState('');
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Re-initialise the fields each time the dialog opens (patient may have
  // changed between opens). This — not a `key` — is how the form stays fresh:
  // a key here would remount a mounted-open Radix dialog (and, sharing the
  // EditPatientDialog key's `${id}:${updatedAt}` value, collide with it),
  // which orphaned the open dialog and left the app pointer-events-locked.
  useEffect(() => {
    if (open) {
      setScope(patient.consentScope ?? 'care');
      setExpiresAt('');
      setExpiryError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the patient prop per open, not per change
  }, [open]);

  const handleSave = async () => {
    // Same rules as the Edit details form: yyyy-mm-dd, in the future.
    if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      setExpiryError('Enter a valid date');
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setExpiryError('Expiry must be in the future');
      return;
    }
    setExpiryError(null);
    setIsSaving(true);
    try {
      const updated = await patientService.recordConsent(patient.id, {
        scope,
        expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00`) : null,
      });
      toast.success(`Photo consent recorded for ${patient.name}`);
      onSaved?.(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Failed to record consent: ${error.message}`
          : 'Failed to record consent. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isRenewal ? 'Record new consent' : 'Record photo consent'}
          </DialogTitle>
          <DialogDescription>
            Record that {patient.name} agrees to clinical photography. Saving writes
            the consent — dated today — to the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="consent-scope">What the consent covers</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as ConsentScope)} disabled={isSaving}>
              <SelectTrigger id="consent-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ConsentScopeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="consent-expiry">Expiry (optional)</Label>
            <Input
              id="consent-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={isSaving}
            />
            <p className="text-sm text-muted-foreground">
              After this date the patient shows as consent-expired. Leave blank for no expiry.
            </p>
            {expiryError && <p className="text-sm text-destructive">{expiryError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Not now
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" />
                Record consent
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
