'use client';

/**
 * Dashboard route-group layout.
 *
 * Collapsible sidebar (AppSidebar) + a slim top bar inside SidebarInset that
 * holds the mobile sidebar trigger, theme toggle, and account menu.
 *
 * NOTE: Auth gate temporarily disabled. All pages are accessible to anyone.
 * Re-enable the `useAuth` checks and redirect to `/login` when ready.
 */

import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-5" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
