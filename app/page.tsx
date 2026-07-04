'use client';

/**
 * Root entry. Acts as a tiny auth-aware router:
 * - While session loads: spinner.
 * - No session: redirect to /login.
 * - Authenticated: redirect to /capture (the primary action).
 *
 * Keeping this outside (dashboard) means unauthenticated users land here first
 * and get bounced to login without flashing dashboard chrome.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Aperture } from 'lucide-react';

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (session) {
      router.replace('/capture');
    } else {
      router.replace('/login');
    }
  }, [loading, session, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Aperture className="size-8 animate-pulse text-primary" />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}
