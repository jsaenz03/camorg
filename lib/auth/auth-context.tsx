'use client';

/**
 * Auth context — single source of truth for the current session on the client.
 *
 * On mount it pings `authService.getCurrentSession()`. Pages under `(dashboard)`
 * consume `useAuth()` to decide whether to render or redirect to /login.
 *
 * NOTE: `authService` calls hit Tauri's SQLite plugin, which only exists at
 * runtime in the desktop shell. During `next build` (SSG) the call throws and
 * we fall back to `loading=false, session=null` — the dashboard gate then
 * redirects to /login at runtime, which is the correct outcome.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Clinician } from '@/types/clinician';
import type { SessionInfo } from '@/specs/001-role-you-are/contracts/auth-service';
import { authService } from '@/lib/services/auth-service';

interface AuthContextValue {
  session: SessionInfo | null;
  clinician: Clinician | null;
  loading: boolean;
  /** Refresh both session + clinician from the DB. */
  refresh: () => Promise<void>;
  /** Clear the session client-side (used by logout flows). */
  clear: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  clinician: null,
  loading: true,
  refresh: async () => {},
  clear: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [clinician, setClinician] = useState<Clinician | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await authService.getCurrentSession();
      setSession(next);
      if (next) {
        try {
          setClinician(await authService.getCurrentClinician());
        } catch {
          setClinician(null);
        }
      } else {
        setClinician(null);
      }
    } catch {
      setSession(null);
      setClinician(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setSession(null);
    setClinician(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh session on window focus so a timeout in another pane is honoured.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, clinician, loading, refresh, clear }),
    [session, clinician, loading, refresh, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
