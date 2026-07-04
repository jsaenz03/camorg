/**
 * SiteNav
 *
 * Persistent top navigation. Visible on every route so back-out-of-flow
 * dead ends (capture, patient view) always have a predictable path home.
 *
 * Sticky, slim, restrained — clinical software, not a marketing site.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Camera, Users, Sun, Moon, Aperture } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

const NAV_LINKS = [
  { href: '/capture', label: 'Capture', icon: Camera },
  { href: '/patients', label: 'Patients', icon: Users },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  // next-themes resolves theme on the client; avoid hydration mismatch
  // by rendering the toggle only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="container mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Aperture className="size-5 text-primary" />
          <span>Camog</span>
        </Link>

        {/* Primary nav */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            // Treat sub-routes (e.g. /patients/view) as active under /patients.
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right: theme toggle */}
        <div className="ml-auto">
          {mounted && (
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              )}
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
