'use client';

/**
 * Admin: users panel. Lists clinicians, lets admin toggle active and role.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, UserCircle } from 'lucide-react';

import type { Clinician, ClinicianRole } from '@/types/clinician';
import { authService } from '@/lib/services/auth-service';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<Clinician[] | null>(null);

  useEffect(() => {
    void authService
      .listUsers()
      .then(setUsers)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load users'));
  }, []);

  async function toggleActive(u: Clinician) {
    try {
      const updated = await authService.setUserActive(u.id, !u.isActive);
      setUsers((prev) => prev?.map((p) => (p.id === u.id ? updated : p)) ?? null);
      toast.success(`${updated.displayName} ${updated.isActive ? 'activated' : 'deactivated'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function changeRole(u: Clinician, role: ClinicianRole) {
    try {
      const updated = await authService.setUserRole(u.id, role);
      setUsers((prev) => prev?.map((p) => (p.id === u.id ? updated : p)) ?? null);
      toast.success(`${updated.displayName} is now ${role}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Manage who can sign in and their role.</CardDescription>
      </CardHeader>
      <CardContent>
        {users === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <ul className="divide-y">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {u.role === 'admin' ? (
                      <ShieldCheck className="size-4 text-primary" />
                    ) : (
                      <UserCircle className="size-4 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {u.displayName}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.username}</p>
                    </div>
                  </div>
                  <Badge variant={u.isActive ? 'default' : 'secondary'}>
                    {u.isActive ? 'active' : 'disabled'}
                  </Badge>
                  <Select
                    value={u.role}
                    onValueChange={(v) => changeRole(u, v as ClinicianRole)}
                    disabled={isSelf}
                  >
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="clinician">clinician</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(u)}
                    disabled={isSelf}
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
