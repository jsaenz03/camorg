'use client';

/**
 * Login screen.
 *
 * - Username + passcode form (react-hook-form + zod).
 * - "Remember my sign-in details" prefills the form on this device;
 *   "Keep me signed in" persists the session across app restarts.
 * - On success: refresh the auth context and redirect to /capture.
 * - Fresh install (zero users): shows a link to /signup, where the first
 *   account becomes the organisation administrator.
 * - "Forgot passcode?" opens the factory-reset dialog — passcodes are only
 *   stored as hashes on this device (no server, no email), so a lost
 *   passcode means deleting all local data and setting up again. Members
 *   should ask an admin to reset theirs from Settings → Users instead.
 * - Dev seed button: visible only when NODE_ENV=development AND zero users.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';

import { clinicianLoginSchema, type ClinicianLogin } from '@/lib/validators/schemas';
import { authService } from '@/lib/services/auth-service';
import { ensureBootstrapped } from '@/lib/db/database';
import { useAuth } from '@/lib/auth/auth-context';
import { toErrorMessage } from '@/lib/utils/error-message';
import { InvalidCredentialsError } from '@/lib/validators/errors';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [userCount, setUserCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [resetting, setResetting] = useState(false);

  const isDev = process.env.NODE_ENV === 'development';

  useEffect(() => {
    void (async () => {
      try {
        // Wait for any env-driven bootstrap so a fresh dev install that is
        // about to create the admin doesn't flash the "no users" UI.
        await ensureBootstrapped();
        const n = await authService.countUsers();
        setUserCount(n);
        setCountError(null);
      } catch (err) {
        setUserCount(null);
        setCountError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const form = useForm<ClinicianLogin>({
    resolver: zodResolver(clinicianLoginSchema),
    defaultValues: { username: '', passcode: '', rememberMe: false, rememberLogin: false },
  });

  // Prefill from remembered details in an effect (not defaultValues) so the
  // prerendered HTML and the first client render stay in sync. Only the
  // username is remembered — never the passcode.
  useEffect(() => {
    const remembered = authService.getRememberedLogin();
    if (remembered) {
      form.reset({
        username: remembered.username,
        passcode: '',
        rememberLogin: true,
      });
    }
  }, [form]);

  async function onSubmit(values: ClinicianLogin) {
    try {
      await authService.login(values);
      await refresh();
      router.replace('/');
    } catch (err) {
      console.error('[login] failed:', err);
      toast.error(
        err instanceof InvalidCredentialsError
          ? err.message
          : toErrorMessage(err, 'Login failed'),
      );
    }
  }

  async function handleSeed() {
    setSeeding(true);
    try {
      const { username, passcode } = await authService.seedDevAdmin();
      toast.success(`Dev admin created. Username: ${username} · Passcode: ${passcode}`);
      form.setValue('username', username);
      form.setValue('passcode', passcode);
      setUserCount(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }

  async function handleResetAndSeed() {
    setSeeding(true);
    try {
      await authService.resetApp('DELETE ALL DATA');
      const { username, passcode } = await authService.seedDevAdmin();
      toast.success(`Reset complete. Dev admin recreated. Username: ${username} · Passcode: ${passcode}`);
      form.setValue('username', username);
      form.setValue('passcode', passcode);
      setUserCount(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSeeding(false);
    }
  }

  // "Forgot passcode?" — factory reset with the typed confirmation phrase.
  // resetApp itself re-checks the phrase, so a mismatch can never wipe data.
  async function handleForgotReset() {
    setResetting(true);
    try {
      await authService.resetApp(confirmPhrase);
      setForgotOpen(false);
      setConfirmPhrase('');
      form.reset({ username: '', passcode: '', rememberMe: false, rememberLogin: false });
      setUserCount(0);
      toast.success('All data deleted. Create the first account to set up again.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  // Show the seed button only when seeding can actually succeed: count is 0
  // (no users) or null (unknown — DB not yet open / migration not run). When
  // users already exist, surface a reset+reseed path instead so the dev isn't
  // locked out of a stale admin account.
  const noUsers = userCount === 0 || userCount === null;
  const showSeed = isDev && noUsers;
  const showReset = isDev && userCount !== null && userCount > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your credentials to continue</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input autoComplete="username" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="passcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Passcode</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rememberLogin"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(v) => field.onChange(v === true)}
                      aria-label="Remember my sign-in details on this device"
                    />
                  </FormControl>
                  <div className="leading-none">
                    <FormLabel>Remember my sign-in details</FormLabel>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Fills in your username next time. Your passcode is never
                      stored on this device.
                    </p>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(v) => field.onChange(v === true)}
                      aria-label="Keep me signed in on this device"
                    />
                  </FormControl>
                  <div className="leading-none">
                    <FormLabel>Keep me signed in on this device</FormLabel>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Stays signed in after closing the app. You can set how long
                      until an automatic sign-out in Settings → Profile.
                    </p>
                  </div>
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Sign in
            </Button>
          </form>
        </Form>

        {/* Fresh install: no accounts exist — route to organisation setup,
            where the first account becomes the admin. */}
        {userCount === 0 && (
          <div className="mt-4 rounded-md border p-3 text-sm">
            <p className="mb-1 font-medium">No accounts yet</p>
            <p className="mb-3 text-muted-foreground">
              Set up your organisation — the first account you create becomes
              the administrator.
            </p>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/signup">Set up your organisation</Link>
            </Button>
          </div>
        )}

        {showSeed && (
          <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">
              {userCount === null
                ? 'User count unavailable (dev mode)'
                : 'No users found (dev mode)'}
            </p>
            {countError && (
              <p className="mb-2 font-mono text-xs text-destructive">
                {countError}
              </p>
            )}
            <p className="mb-3 text-muted-foreground">
              Seed an admin for testing. You will be asked to change the passcode on first use.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSeed}
              disabled={seeding}
            >
              {seeding && <Loader2 className="mr-2 size-4 animate-spin" />}
              Seed dev admin
            </Button>
          </div>
        )}

        {showReset && (
          <div className="mt-4 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="mb-1 font-medium">
              {userCount} user{userCount === 1 ? '' : 's'} exist (dev mode)
            </p>
            <p className="mb-3 text-muted-foreground">
              Seeding is refused while users exist. To start fresh, wipe all local data
              (patients, photos, users) and reseed the dev admin.
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                if (window.confirm('This deletes ALL local data and recreates the dev admin. Continue?')) {
                  handleResetAndSeed();
                }
              }}
              disabled={seeding}
            >
              {seeding && <Loader2 className="mr-2 size-4 animate-spin" />}
              Reset &amp; reseed
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/signup" className="flex items-center justify-center gap-2">
            <UserPlus className="size-4" />
            Sign up
          </Link>
        </Button>
        <Button variant="link" size="sm" onClick={() => setForgotOpen(true)}>
          Forgot passcode?
        </Button>
        <p className="pt-1 text-center text-xs text-muted-foreground">
          <Link href="/legal#terms-of-service" className="underline-offset-2 hover:underline">
            Terms of Service
          </Link>
          {' · '}
          <Link href="/legal#privacy-policy" className="underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </CardFooter>

      <Dialog open={forgotOpen} onOpenChange={(open) => {
        setForgotOpen(open);
        if (!open) setConfirmPhrase('');
      }}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Camog?</DialogTitle>
          <DialogDescription>
            Passcodes are stored only as secure hashes on this device — there is
            no server or email address to send a recovery link to. The only way
            back in without a passcode is a factory reset.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            This permanently deletes everything on this device: patients, photos,
            users, settings, and backups stored in the photos folder. Your
            licence activation is kept.{' '}
            <span className="font-medium text-foreground">
              If only a member forgot their passcode, an admin can reset it in
              Settings → Users instead — no data is lost.
            </span>
          </p>
          <div>
            <label
              htmlFor="forgot-confirm"
              className="mb-2 block text-sm font-medium leading-none"
            >
              Type <span className="font-mono">DELETE ALL DATA</span> to confirm
            </label>
            <Input
              id="forgot-confirm"
              autoComplete="off"
              placeholder="DELETE ALL DATA"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setForgotOpen(false)} disabled={resetting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirmPhrase !== 'DELETE ALL DATA' || resetting}
            onClick={() => {
              void handleForgotReset();
            }}
          >
            {resetting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Delete everything
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
