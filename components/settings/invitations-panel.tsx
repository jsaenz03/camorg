'use client';

/**
 * Admin: invitations panel.
 *
 * - Create invite (token or precreated) via a dialog form.
 * - Reveal a freshly-created token once for the admin to copy.
 * - List pending + accepted invitations; revoke pending ones.
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react';

import type { Invitation } from '@/types/invitation';
import {
  invitationCreateSchema,
  type InvitationCreate,
} from '@/lib/validators/schemas';
import { authService } from '@/lib/services/auth-service';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const emptyForm: InvitationCreate = {
  kind: 'token',
  username: '',
  displayName: '',
  role: 'clinician',
  ttlDays: 7,
};

export function InvitationsPanel() {
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<Invitation | null>(null);

  const form = useForm<InvitationCreate>({
    resolver: zodResolver(invitationCreateSchema),
    defaultValues: emptyForm,
  });

  const kind = form.watch('kind');

  async function refresh() {
    try {
      const list = await authService.listInvitations();
      setInvites(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load invitations');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSubmit(values: InvitationCreate) {
    try {
      const created = await authService.createInvitation(values);
      toast.success('Invitation created');
      setRevealed(created);
      setOpen(false);
      form.reset(emptyForm);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function revoke(id: string) {
    try {
      await authService.revokeInvitation(id);
      toast.success('Invitation revoked');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>Invite new users by code or precreated account.</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 size-4" /> New
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create invitation</DialogTitle>
              <DialogDescription>
                Token invites let the user pick their own passcode. Precreated accounts use a
                temporary passcode you set.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kind</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="token">Token (user sets passcode)</SelectItem>
                          <SelectItem value="precreated">Precreated (admin sets temp passcode)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="displayName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Display name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="clinician">clinician</SelectItem>
                            <SelectItem value="admin">admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ttlDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expires (days)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            max={90}
                            value={field.value}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {kind === 'precreated' && (
                  <FormField
                    control={form.control}
                    name="tempPasscode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Temporary passcode</FormLabel>
                        <FormControl>
                          <Input type="text" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <DialogFooter>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        {revealed && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="mb-1 font-medium">
              {revealed.kind === 'precreated'
                ? 'Account created. Share these credentials:'
                : 'Share this invite code (shown once):'}
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-background px-2 py-1 font-mono text-base tracking-widest">
                {revealed.token}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(revealed.token);
                  toast.success('Code copied');
                }}
              >
                <Copy className="size-4" />
              </Button>
              {revealed.kind === 'precreated' && (
                <span className="text-muted-foreground">
                  temp passcode set by you
                </span>
              )}
            </div>
            <Button
              variant="link"
              size="sm"
              className="mt-1 h-auto p-0"
              onClick={() => setRevealed(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {invites === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        ) : (
          <ul className="divide-y">
            {invites.map((inv) => {
              const expired = !inv.acceptedAt && Date.now() > inv.expiresAt.getTime();
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {inv.displayName}{' '}
                      <span className="text-muted-foreground">· {inv.username}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      role: {inv.role} · kind: {inv.kind} · expires{' '}
                      {inv.expiresAt.toLocaleDateString()}
                    </p>
                  </div>
                  {inv.acceptedAt ? (
                    <Badge variant="secondary">accepted</Badge>
                  ) : expired ? (
                    <Badge variant="outline">expired</Badge>
                  ) : (
                    <Badge>pending</Badge>
                  )}
                  {!inv.acceptedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(inv.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
