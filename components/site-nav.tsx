/**
 * SiteNav
 *
 * Persistent top navigation for the (dashboard) route group.
 *
 * Renders brand + primary nav + theme toggle + user menu (display name,
 * role badge, Settings link, Log out). Auth screens render without SiteNav
 * (see app/(auth)/layout.tsx).
 */

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import {
  Camera,
  Users,
  Sun,
  Moon,
  Aperture,
  Settings as SettingsIcon,
  LogOut,
  ShieldCheck,
  UserCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/services/auth-service';

const NAV_LINKS = [
  { href: '/capture', label: 'Capture', icon: Camera },
  { href: '/patients', label: 'Patients', icon: Users },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { clinician, clear } = useAuth();

  // next-themes resolves theme on the client; avoid hydration mismatch
  // by rendering the toggle only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  async function handleLogout() {
    await authService.logout();
    clear();
    router.replace('/login');
  }

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

        {/* Right: theme toggle + user menu */}
        <div className="ml-auto flex items-center gap-1">
          {mounted && (
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          )}

          {clinician && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                  )}
                >
                  {clinician.role === 'admin' ? (
                    <ShieldCheck className="size-4 text-primary" />
                  ) : (
                    <UserCircle className="size-4" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-0">
                <div className="border-b p-3">
                  <p className="truncate text-sm font-medium">
                    {clinician.displayName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {clinician.username}
                  </p>
                  <Badge variant="secondary" className="mt-2">
                    {clinician.role}
                  </Badge>
                </div>
                <div className="p-1">
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <SettingsIcon className="size-4" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                  >
                    <LogOut className="size-4" />
                    Log out
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </header>
  );
}
