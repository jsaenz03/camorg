'use client';

/**
 * BuyLicenceLink — opens the hosted buy page (Stripe checkout) in the system
 * browser. Shown wherever an unlicensed or renewing user looks for a key:
 * the activation dialog, the trial/read-only banners, and Settings → Licence.
 * Purchase and key delivery happen entirely outside the app.
 */

import { ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { BUY_LICENCE_URL } from '@/lib/licence/buy-url';

export function BuyLicenceLink({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline ${className}`}
      onClick={() => {
        openUrl(BUY_LICENCE_URL).catch(() => {});
      }}
    >
      Buy a licence
      <ExternalLink className="size-3" />
    </button>
  );
}
