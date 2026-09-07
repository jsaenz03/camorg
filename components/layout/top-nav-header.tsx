/**
 * TopNavHeader
 *
 * Header for the "tabs at the top" navigation layout: brand + horizontal
 * nav tabs + theme/account actions in one sticky bar, replacing the
 * sidebar. Badges mirror the sidebar's pending-action counters.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBranding } from '@/components/branding-boot';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { NAV_LINKS, isActive, useNavBadges } from '@/components/layout/nav-config';

export function TopNavHeader() {
  const pathname = usePathname();
  const { orgName, logoDataUrl } = useBranding();
  const badgeFor = useNavBadges();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="flex h-14 items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static export / inline data URL; brand mark */}
          <img
            src={logoDataUrl ?? '/logo.png'}
            alt={orgName}
            className="aspect-square size-8 rounded-lg object-contain"
          />
          <span className="hidden truncate text-sm font-semibold md:inline">
            {orgName}
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            const badge = badgeFor(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={
                  'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring ' +
                  (active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground')
                }
              >
                <Icon className="size-4" />
                <span>{label}</span>
                {badge > 0 && (
                  <span className="rounded-md bg-primary/10 px-1 text-xs font-semibold tabular-nums text-primary">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
