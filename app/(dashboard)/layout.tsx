'use client';

/**
 * Dashboard route-group layout.
 *
 * Collapsible sidebar (AppSidebar) + a slim top bar inside SidebarInset that
 * holds the mobile sidebar trigger, theme toggle, and account menu.
 *
 * Auth gate: redirects to /login when no session is present. Holds a minimal
 * skeleton while the session is resolving so we never flash protected UI.
 * Also mounts the idle privacy lock (Settings → App → idle timeout) and
 * blocks on a must-change-passcode screen for temporary-passcode accounts
 * (precreated invitations, dev seed) until a new passcode is set.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { IdleLockOverlay } from '@/components/idle-lock-overlay';
import { LicenceBanner } from '@/components/licence/licence-banner';
import { ChangePasscodeForm } from '@/components/settings/change-passcode-form';
import { useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/services/auth-service';
import { Skeleton } from '@/components/ui/skeleton';

function IdleLockGate() {
  // 5 min fallback while settings load; the real value (0 = off) arrives once.
  const [timeoutMs, setTimeoutMs] = useState(300_000);

  useEffect(() => {
    let cancelled = false;
    authService
      .getSettings()
      .then((s) => {
        if (!cancelled) setTimeoutMs(s.idleLockTimeoutMs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <IdleLockOverlay timeoutMs={timeoutMs} />;
}

/**
 * Blocking gate for accounts still on a temporary passcode (precreated
 * invitations, dev seed): the app chrome stays hidden until a new passcode
 * is set. An escape hatch signs out instead of trapping the wrong user.
 */
function MustChangePasscodeGate({
  onDone,
  onSignOut,
}: {
  onDone: () => Promise<void>;
  onSignOut: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold">Set a new passcode</h1>
          <p className="text-sm text-muted-foreground">
            You signed in with a temporary passcode. Choose a new one to
            continue using Camog.
          </p>
        </div>
        <ChangePasscodeForm onchanged={onDone} />
        <Button variant="ghost" size="sm" className="w-full" onClick={onSignOut}>
          Sign out instead
        </Button>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { session, clinician, loading, refresh, clear } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="h-14 border-b" />
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (clinician?.mustChangePasscode) {
    return (
      <MustChangePasscodeGate
        onDone={refresh}
        onSignOut={() => {
          void (async () => {
            await authService.logout();
            clear();
            router.replace('/login');
          })();
        }}
      />
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <LicenceBanner />
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
      <IdleLockGate />
    </SidebarProvider>
  );
}
