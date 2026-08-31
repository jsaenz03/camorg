/**
 * AppSidebar
 *
 * Primary navigation for the (dashboard) route group. Collapsible
 * (desktop rail + mobile sheet). Brand header, grouped nav, and a user
 * footer. Replaces the legacy top SiteNav.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Aperture,
  Camera,
  Users,
  Images,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAuth } from '@/lib/auth/auth-context';
import { useBranding } from '@/components/branding-boot';
import { useNotifications } from '@/lib/hooks/use-notifications';
import { useCompanion } from '@/components/companion/companion-provider';
import { useCapture } from '@/components/capture/capture-provider';
import { PhoneLinkDialog } from '@/components/companion/phone-link-dialog';
import { SidebarMenuBadge } from '@/components/ui/sidebar';

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_SECTIONS: { label: string; items: NavLink[] }[] = [
  {
    label: 'Workspace',
    items: [{ href: '/', label: 'Dashboard', icon: Aperture }],
  },
  {
    label: 'Library',
    items: [
      { href: '/patients', label: 'Patients', icon: Users },
      { href: '/photos', label: 'Photos', icon: Images },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppSidebar() {
  const pathname = usePathname();
  const { clinician } = useAuth();
  const { orgName, logoDataUrl } = useBranding();
  const { counts } = useNotifications();
  const companion = useCompanion();
  const { openCapture } = useCapture();

  // Pending-action counters per nav item: dashboard carries the total,
  // patients the review-attention subset, settings the admin's approval
  // queue (0 for non-admins — the service gates it).
  const badgeFor = (href: string): number => {
    if (!counts) return 0;
    switch (href) {
      case '/':
        return counts.total;
      case '/patients':
        return (
          counts.reviewOverdue +
          counts.reviewDueSoon +
          counts.reviewStale +
          counts.photoReviewOverdue +
          counts.photoReviewDueSoon
        );
      case '/settings':
        return counts.pendingSignups;
      default:
        return 0;
    }
  };

  return (
    <Sidebar collapsible="icon">
      {/* Brand */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={orgName}>
              <Link href="/">
                {/* eslint-disable-next-line @next/next/no-img-element -- static export / inline data URL; brand mark */}
                <img
                  src={logoDataUrl ?? '/logo.png'}
                  alt={orgName}
                  className="aspect-square size-8 rounded-lg object-contain"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{orgName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Clinical Photos
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Nav */}
      <SidebarContent>
        {NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map(({ href, label, icon: Icon }) => {
                  const badge = badgeFor(href);
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(pathname, href)}
                        tooltip={label}
                      >
                        <Link href={href}>
                          <Icon className="size-4" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badge > 0 && (
                        <SidebarMenuBadge className="bg-primary/10 text-primary font-semibold">
                          {badge > 99 ? '99+' : badge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
                {/* Capture: opens the capture dialog in place — no route to
                    navigate away to. */}
                {section.label === 'Workspace' && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => openCapture()}
                      tooltip="Capture"
                    >
                      <Camera className="size-4" />
                      <span>Capture</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {/* Phone link: companion session control, not a route. The
                    dot is a live-session indicator (privacy state, not
                    decoration) — it says the link is still open. */}
                {section.label === 'Workspace' && (
                  <SidebarMenuItem>
                    <PhoneLinkDialog>
                      <SidebarMenuButton tooltip="Phone link">
                        <span className="relative">
                          <Smartphone className="size-4" />
                          {companion.active && (
                            <span
                              className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary"
                              aria-label="Phone link session active"
                            />
                          )}
                        </span>
                        <span>Phone link</span>
                      </SidebarMenuButton>
                    </PhoneLinkDialog>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* User footer */}
      {clinician && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip="Settings">
                <Link href="/settings">
                  {clinician.role === 'admin' ? (
                    <ShieldCheck className="size-8 rounded-lg bg-primary/10 p-1.5 text-primary" />
                  ) : (
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {initials(clinician.displayName)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{clinician.displayName}</span>
                    <Badge variant="secondary" className="mt-0.5 w-fit text-[10px]">
                      {clinician.role}
                    </Badge>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
