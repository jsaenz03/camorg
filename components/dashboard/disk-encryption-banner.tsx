'use client';

/**
 * DiskEncryptionBanner — warns while the system volume is unencrypted.
 *
 * Photos are app-encrypted, but the patient database (names, details,
 * consent records) inherits the volume's protection: without BitLocker or
 * FileVault, a lost or stolen workstation is a notifiable data breach. The
 * app warns — it cannot turn disk encryption on, so the banner points at
 * the practice's IT. Dismissal is stamped with the app version, so an
 * update re-surfaces the check once; Settings → Diagnostics always shows
 * the current state.
 */

import { useEffect, useState } from 'react';
import { HardDrive, X } from 'lucide-react';

import { diskEncryptionStatus } from '@/lib/diagnostics';
import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'camog.disk-encryption.dismissed-at';

export function DiskEncryptionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void diskEncryptionStatus().then(({ state, appVersion }) => {
      if (cancelled || state !== 'off') return;
      if (localStorage.getItem(DISMISS_KEY) === appVersion) return;
      setVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    void diskEncryptionStatus().then(({ appVersion }) => {
      localStorage.setItem(DISMISS_KEY, appVersion);
    });
  };

  return (
    <div className="flex items-center justify-center gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-1.5 text-sm text-destructive">
      <HardDrive className="size-4" />
      <span>
        Disk encryption is off — patient details are readable if this computer
        is lost or stolen. Ask your IT contact to turn on BitLocker or
        FileVault.
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7"
        onClick={dismiss}
        aria-label="Dismiss disk encryption warning"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
