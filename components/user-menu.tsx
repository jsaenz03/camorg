/**
 * UserMenu
 *
 * Account dropdown for the dashboard top bar. Shows avatar + display name,
 * with role badge, Settings link, and Log out. Replaces the Popover account
 * menu that lived in the legacy SiteNav.
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/services/auth-service';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu() {
  const router = useRouter();
  const { clinician, clear } = useAuth();

  if (!clinician) return null;

  async function handleLogout() {
    await authService.logout();
    clear();
    router.replace('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Account menu">
          {clinician.role === 'admin' ? (
            <ShieldCheck className="size-4 text-primary" />
          ) : (
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials(clinician.displayName)}</AvatarFallback>
            </Avatar>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate text-sm font-medium">{clinician.displayName}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {clinician.username}
          </span>
          <Badge variant="secondary" className="mt-1 w-fit">
            {clinician.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLogout} variant="destructive">
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
