'use client';

/**
 * Auth route-group layout.
 *
 * Centered single column with no SiteNav — auth screens shouldn't show app
 * chrome. Includes a small dev-only build-info footer for testing context.
 */

import { Aperture } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
