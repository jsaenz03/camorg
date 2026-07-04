'use client';

/**
 * Dashboard route-group layout.
 *
 * Acts as the auth gate: every page under (dashboard) requires an active
 * session. While the session is being resolved we show a slim skeleton;
 * once resolved, if there's no session we redirect to /login.
 *
 * SiteNav lives here (not in the root layout) so auth screens render without
 * the app chrome.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SiteNav } from '@/components/site-nav';
import { useAuth } from '@/lib/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login');
    }
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="border-b">
          <div className="container mx-auto flex h-14 max-w-5xl items-center px-4">
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
        <main className="flex-1 container mx-auto max-w-5xl px-4 py-8">
          <Skeleton className="h-8 w-48" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
