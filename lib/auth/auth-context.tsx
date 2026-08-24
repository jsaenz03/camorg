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

  // On window focus: extend the session first (activity), then re-read. A
  // lapsed session is NOT extended — refreshSession's expiry check inside
  // getCurrentRow refuses it and refresh() then sees the logout. This makes
  // the auto-logout setting idle-based instead of absolute-from-sign-in, and
  // honours a timeout enforced in another pane.
  useEffect(() => {
    const onFocus = () => {
      void (async () => {
        try {
          await authService.refreshSession();
        } catch {
          // not signed in or already expired — refresh() below reports it
        }
        await refresh();
      })();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // A desktop window that stays focused never refires `focus`, so actual
  // input must also keep the session alive — otherwise a clinician capturing
  // past the timeout is signed out mid-work. Real input (not mere focus)
  // extends the session, throttled to once per minute; an untouched window
  // lets the auto-logout lapse exactly as configured.
  useEffect(() => {
    let lastExtension = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastExtension < 60_000) return;
      lastExtension = now;
      void authService.refreshSession().catch(() => {});
    };
    for (const evt of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    return () => {
      for (const evt of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, clinician, loading, refresh, clear }),
    [session, clinician, loading, refresh, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
