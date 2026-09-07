/**
 * AppSidebar
 *
 * Primary navigation for the (dashboard) route group. Collapsible
 * (desktop rail + mobile sheet). Brand header, grouped nav, and a user
 * footer. Replaces the legacy top SiteNav. Renders on the left by default;
 * pass side="right" to mirror it.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
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
import { NAV_SECTIONS, isActive, useNavBadges } from '@/components/layout/nav-config';
import { SidebarMenuBadge } from '@/components/ui/sidebar';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppSidebar({ side = 'left' }: { side?: 'left' | 'right' }) {
  const pathname = usePathname();
  const { clinician } = useAuth();
  const { orgName, logoDataUrl } = useBranding();
  const badgeFor = useNavBadges();
  // Collapsed-rail tooltips open away from the screen edge the rail sits on.
  const tooltipSide = side === 'right' ? ('left' as const) : ('right' as const);

  return (
    <Sidebar collapsible="icon" side={side}>
      {/* Brand */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip={{ children: orgName, side: tooltipSide }}
            >
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
                        tooltip={{ children: label, side: tooltipSide }}
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
              <SidebarMenuButton
                size="lg"
                asChild
                tooltip={{ children: 'Settings', side: tooltipSide }}
              >
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
