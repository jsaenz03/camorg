'use client';

/**
 * Auth route-group layout.
 *
 * Centered single column with no SiteNav — auth screens shouldn't show app
 * chrome. Includes a small dev-only build-info footer for testing context.
 *
 * If a session already exists, bounce to the dashboard so an authenticated
 * user who hits /login doesn't see the auth screen.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Aperture } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/auth-context';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (session) router.replace('/');
  }, [loading, session, router]);

  if (session) return null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 font-semibold tracking-tight"
        >
          <Aperture className="size-6 text-primary" />
          <span className="text-lg">Camog</span>
        </Link>
        {children}
        {process.env.NODE_ENV === 'development' && (
          <p className="mt-8 text-center text-xs text-muted-foreground">
            dev build · local SQLite only
          </p>
        )}
      </div>
    </div>
  );
}
