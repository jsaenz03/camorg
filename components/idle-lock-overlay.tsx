'use client';

/**
 * IdleLockOverlay
 *
 * Privacy screen for clinic rooms: after a configurable period with no
 * pointer/keyboard/wheel/touch activity, the whole dashboard is covered by a
 * blurred overlay and the signed-in clinician's passcode is required to
 * continue. The session itself stays signed in — this is a privacy screen
 * (hides patient data from passers-by), not a security re-authentication;
 * the sign-out path remains the real session timeout in auth-service.
 *
 * Mount once in the dashboard layout. `timeoutMs <= 0` disables it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/services/auth-service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
];

/** Check interval — 5s granularity keeps the lock prompt snappy. */
const TICK_MS = 5_000;

export function IdleLockOverlay({ timeoutMs }: { timeoutMs: number }) {
  const { clinician } = useAuth();
  const [locked, setLocked] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const lastActivityRef = useRef(Date.now());

  const touch = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    lastActivityRef.current = Date.now();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, touch, { passive: true });
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        setLocked(true);
      }
    }, TICK_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, touch);
      }
      window.clearInterval(timer);
    };
  }, [timeoutMs, touch]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode) return;
    setIsVerifying(true);
    setError(null);
    try {
      const ok = await authService.verifyCurrentPasscode(passcode);
      if (ok) {
        setLocked(false);
        setPasscode('');
        lastActivityRef.current = Date.now();
      } else {
        setError('Incorrect passcode');
      }
    } catch {
      // Session vanished (signed out elsewhere) — the dashboard auth gate
      // will redirect; nothing to unlock here.
      setLocked(false);
      setPasscode('');
    } finally {
      setIsVerifying(false);
    }
  }

  if (!locked) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Screen locked"
    >
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Screen locked</h2>
            <p className="text-sm text-muted-foreground">
              {clinician ? `Enter your passcode to continue, ${clinician.displayName}.` : 'Enter your passcode to continue.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="idle-lock-passcode">Passcode</Label>
            <Input
              id="idle-lock-passcode"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={isVerifying}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isVerifying || !passcode}>
            {isVerifying && <Loader2 className="size-4 animate-spin" />}
            Unlock
          </Button>
        </form>
      </div>
    </div>
  );
}
