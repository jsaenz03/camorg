'use client';

/**
 * Licence context — single source of truth for the install's licence state.
 *
 * Loads once on mount (like AuthProvider) and exposes `writable` for gating
 * write entry points. Enforcement happens at mount/navigation only — never
 * yank a running session mid-consultation; the banner surfaces state changes.
 *
 * The activation dialog itself is rendered in the root layout (sibling of
 * this provider) so any surface can call openActivation() without prop
 * drilling or import cycles.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { licenceService } from '@/lib/services/licence-service';
import { onLicenceBlocked } from '@/lib/licence/guard';
import type { LicenceStatus } from '@/specs/002-offline-licence/contracts/licence-service';

interface LicenceContextValue {
  status: LicenceStatus | null;
  loading: boolean;
  /** True unless the install is read-only. Fail-open while status is unknown
   *  (build-time SSG, transient DB error) — licensing must never brick the
   *  clinic on a read failure; the banner re-surfaces the state later. */
  writable: boolean;
  /** Re-read licence state from the DB. */
  refresh: () => Promise<void>;
  activationOpen: boolean;
  openActivation: () => void;
  closeActivation: () => void;
}

const LicenceContext = createContext<LicenceContextValue>({
  status: null,
  loading: true,
  writable: true,
  refresh: async () => {},
  activationOpen: false,
  openActivation: () => {},
  closeActivation: () => {},
});

export function LicenceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activationOpen, setActivationOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await licenceService.getStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A service-layer licence guard tripping anywhere opens the dialog.
  useEffect(() => onLicenceBlocked(() => setActivationOpen(true)), []);

  return (
    <LicenceContext.Provider
      value={{
        status,
        loading,
        writable: status ? status.state !== 'read-only' : true,
        refresh,
        activationOpen,
        openActivation: () => setActivationOpen(true),
        closeActivation: () => setActivationOpen(false),
      }}
    >
      {children}
    </LicenceContext.Provider>
  );
}

export function useLicence() {
  return useContext(LicenceContext);
}
