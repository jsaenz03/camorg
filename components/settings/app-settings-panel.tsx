'use client';

/**
 * Admin: app settings. Toggles public signup, session timeout, org name.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import type { AppSettings } from '@/types/invitation';
import {
  settingsUpdateSchema,
  type SettingsUpdate,
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const TIMEOUT_OPTIONS = [
  { label: '15 minutes', ms: 15 * 60 * 1000 },
  { label: '30 minutes', ms: 30 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
];

const IDLE_LOCK_OPTIONS = [
  { label: 'Off', ms: 0 },
  { label: '1 minute', ms: 60 * 1000 },
  { label: '2 minutes', ms: 2 * 60 * 1000 },
  { label: '5 minutes', ms: 5 * 60 * 1000 },
  { label: '10 minutes', ms: 10 * 60 * 1000 },
  { label: '30 minutes', ms: 30 * 60 * 1000 },
];

export function AppSettingsPanel() {
  const [initial, setInitial] = useState<AppSettings | null>(null);

  const form = useForm<SettingsUpdate>({
    resolver: zodResolver(settingsUpdateSchema),
  });

  useEffect(() => {
    void authService
      .getSettings()
      .then((s) => {
        setInitial(s);
        form.reset({
          sessionTimeoutMs: s.sessionTimeoutMs,
          allowPublicSignup: s.allowPublicSignup,
          orgName: s.orgName,
          idleLockTimeoutMs: s.idleLockTimeoutMs,
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load settings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: SettingsUpdate) {
    try {
      const updated = await authService.updateSettings(values);
      setInitial(updated);
      form.reset({
        sessionTimeoutMs: updated.sessionTimeoutMs,
        allowPublicSignup: updated.allowPublicSignup,
        orgName: updated.orgName,
        idleLockTimeoutMs: updated.idleLockTimeoutMs,
      });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  }

  if (!initial) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App settings</CardTitle>
        <CardDescription>Organisation-wide configuration.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="orgName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organisation name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sessionTimeoutMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Session timeout</FormLabel>
                  <FormControl>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={field.value ?? initial.sessionTimeoutMs}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    >
                      {TIMEOUT_OPTIONS.map((o) => (
                        <option key={o.ms} value={o.ms}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>
                    Users are signed out after this period of inactivity. Each
                    user can choose their own timeout in Settings → Profile;
                    this is the organisation default.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="idleLockTimeoutMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Idle privacy lock</FormLabel>
                  <FormControl>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={field.value ?? initial.idleLockTimeoutMs}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    >
                      {IDLE_LOCK_OPTIONS.map((o) => (
                        <option key={o.ms} value={o.ms}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>
                    After this period of inactivity the screen blurs and asks for the
                    passcode again — handy when patient data is visible in a clinic room.
                    The session itself stays signed in.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="allowPublicSignup"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>Allow public sign up</FormLabel>
                    <FormDescription>
                      When on, anyone can request access; accounts stay pending
                      until approved in Users. When off, new users can only join
                      via an admin invite.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value ?? false}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Save
            </Button>
          </form>
        </Form>
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          <Link href="/legal" className="underline-offset-2 hover:underline">
            Terms of Service &amp; Privacy Policy
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
