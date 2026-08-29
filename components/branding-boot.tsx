'use client';

/**
 * Brand application + distribution.
 *
 * applyBrand injects the derived brand palette as a <style> tag so the chosen
 * colours win over the built-in teal in both themes, app-wide. It is
 * idempotent; the settings page calls it directly for a live preview.
 *
 * BrandingProvider loads the saved branding once per full page load (and on
 * refresh() after the admin edits it), applies the colours, and shares the
 * business name + logo with the sidebar and auth screens. Silently falls back
 * to the built-in branding in the plain browser preview (no database there).
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { brandStyleCss } from '@/lib/branding';
import { authService } from '@/lib/services/auth-service';

const STYLE_ID = 'camog-brand';

export function applyBrand(primary: string | null, accent: string | null): void {
  if (typeof document === 'undefined') return;
  const css = brandStyleCss(primary, accent);
  let el = document.getElementById(STYLE_ID);
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

interface Branding {
  orgName: string;
  logoDataUrl: string | null;
  /** Re-read the settings row (call after the admin edits branding). */
  refresh: () => void;
}

const BrandingContext = createContext<Branding>({
  orgName: 'Camog',
  logoDataUrl: null,
  refresh: () => {},
});

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Omit<Branding, 'refresh'>>({
    orgName: 'Camog',
    logoDataUrl: null,
  });

  const refresh = useCallback(() => {
    authService
      .getSettings()
      .then((s) => {
        applyBrand(s.brandPrimary, s.brandAccent);
        setBranding({ orgName: s.orgName, logoDataUrl: s.logoDataUrl });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <BrandingContext.Provider value={{ ...branding, refresh }}>{children}</BrandingContext.Provider>;
}
