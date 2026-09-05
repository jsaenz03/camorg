'use client';

/**
 * Signup screen.
 *
 * Modes:
 *  1. First run (zero users) — organisation setup: the first account created
 *     becomes the organisation admin. This is the production bootstrap path;
 *     no invite can exist because no admin exists to issue one.
 *  2. `?token=XXXX` — invite-token flow: resolve the invitation, prefill
 *     username/displayName, set a fresh passcode, accept the invitation.
 *  3. No token + `allow_public_signup` — open registration. The account is
 *     created pending; an admin approves it in Settings → Users before it can
 *     sign in. An "I have an invite code" link swaps in the code field so
 *     invited users can always reach mode 2.
 *  4. No token + invite-only — inline code field; on submit, resolve the
 *     invitation and switch to mode 2.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';

import {
  clinicianRegisterSchema,
  invitationAcceptSchema,
  type ClinicianRegister,
  type InvitationAccept,
} from '@/lib/validators/schemas';
import { authService } from '@/lib/services/auth-service';
import { ensureBootstrapped } from '@/lib/db/database';
import { useAuth } from '@/lib/auth/auth-context';
import { toErrorMessage } from '@/lib/utils/error-message';
import { NotFoundError } from '@/lib/validators/errors';
import type { Invitation } from '@/types/invitation';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';

interface BootState {
  userCount: number; // -1 = unknown (DB unavailable) → treat as not first-run
  publicSignup: boolean;
}

function SignupInner() {
  const router = useRouter();
  const { refresh } = useAuth();
  const params = useSearchParams();
  const tokenParam = params.get('token')?.trim() ?? '';

  const [boot, setBoot] = useState<BootState | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [orgName, setOrgName] = useState('');
  const [pendingSubmitted, setPendingSubmitted] = useState(false);
  // Public-signup mode only: swaps the request-access form for the code field.
  const [showCodeEntry, setShowCodeEntry] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // Let any env-driven admin bootstrap settle first so the user count
        // reflects reality (dev convenience; production relies on first-run
        // setup below).
        await ensureBootstrapped();
        const [settings, count] = await Promise.all([
          authService.getSettings(),
          authService.countUsers(),
        ]);
        setBoot({ userCount: count, publicSignup: settings.allowPublicSignup });
      } catch {
        setBoot({ userCount: -1, publicSignup: false });
      }
    })();
  }, []);

  // Resolve the token from the URL on mount.
  useEffect(() => {
    if (!tokenParam) return;
    void authService
      .resolveInvitation(tokenParam)
      .then((inv) => {
        setInvitation(inv);
        acceptForm.reset({
          token: tokenParam,
          username: inv.username,
          displayName: inv.displayName,
          passcode: '',
        });
      })
      .catch((err) => {
        setResolveError(err instanceof Error ? err.message : 'Invalid invite code');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam]);

  // ----- token-accept form -----
  const acceptForm = useForm<InvitationAccept>({
    resolver: zodResolver(invitationAcceptSchema),
    defaultValues: {
      token: tokenParam,
      username: invitation?.username ?? '',
      displayName: invitation?.displayName ?? '',
      passcode: '',
    },
  });

  async function onAccept(values: InvitationAccept) {
    try {
      await authService.acceptInvitation(values);
      await refresh();
      toast.success('Account created');
      router.replace('/');
    } catch (err) {
      console.error('[signup] invite accept failed:', err);
      toast.error(toErrorMessage(err, 'Sign up failed'));
    }
  }

  // ----- shared form: first-run setup (admin) and open signup (pending) -----
  const registerForm = useForm<ClinicianRegister>({
    resolver: zodResolver(clinicianRegisterSchema),
    defaultValues: { username: '', displayName: '', passcode: '' },
  });

  async function onSetupFirstAdmin(values: ClinicianRegister) {
    try {
      const admin = await authService.register(values);
      // Register auto-logs the first admin in, so the settings call is
      // authorised. Best-effort — editable later in Settings.
      const name = orgName.trim();
      if (name) {
        try {
          await authService.updateSettings({ orgName: name });
        } catch {
          // non-fatal
        }
      }
      await refresh();
      toast.success(`Organisation ready — welcome, ${admin.displayName}`);
      router.replace('/');
    } catch (err) {
      console.error('[signup] organisation setup failed:', err);
      toast.error(toErrorMessage(err, 'Set up failed'));
    }
  }

  async function onRegister(values: ClinicianRegister) {
    try {
      const created = await authService.register(values);
      if (created.isPending) {
        setPendingSubmitted(true);
        return;
      }
      await refresh();
      toast.success('Account created');
      router.replace('/');
    } catch (err) {
      console.error('[signup] registration failed:', err);
      toast.error(toErrorMessage(err, 'Sign up failed'));
    }
  }

  // ----- render -----

  if (tokenParam && resolveError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite invalid</CardTitle>
          <CardDescription>{resolveError}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="ghost" size="sm" asChild className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 size-4" /> Back to sign in
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (tokenParam) {
    if (!invitation) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Resolving invite…</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking invite code
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Complete sign up</CardTitle>
          <CardDescription>
            You were invited as <span className="font-medium">{invitation.role}</span>.
            Set a passcode to finish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...acceptForm}>
            <form onSubmit={acceptForm.handleSubmit(onAccept)} className="space-y-4">
              <FormField
                control={acceptForm.control}
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
                control={acceptForm.control}
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
                control={acceptForm.control}
                name="passcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passcode</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormDescription>
                      At least 8 characters with a letter and a number.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={acceptForm.formState.isSubmitting}
              >
                {acceptForm.formState.isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Create account
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    );
  }

  // No token. Await the boot state (settings + user count).
  if (!boot) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </CardContent>
      </Card>
    );
  }

  // ----- first run: organisation setup -----
  if (boot.userCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set up your organisation</CardTitle>
          <CardDescription>
            No accounts exist yet. The first account you create becomes the
            organisation administrator, who can then invite or approve other
            members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...registerForm}>
            <form
              onSubmit={registerForm.handleSubmit(onSetupFirstAdmin)}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="org-name"
                  className="mb-2 block text-sm font-medium leading-none"
                >
                  Organisation name <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="org-name"
                  placeholder="e.g. Brisbane Skin Clinic"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>
              <FormField
                control={registerForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
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
                control={registerForm.control}
                name="passcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passcode</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormDescription>
                      At least 8 characters with a letter and a number.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={registerForm.formState.isSubmitting}
              >
                {registerForm.formState.isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Create admin account
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    );
  }

  // ----- invite-code entry (default in invite-only mode; reachable from
  // public mode via the "I have an invite code" toggle) -----
  const lookup = async () => {
    const code = codeInput.trim();
    if (!code) {
      toast.error('Enter an invite code');
      return;
    }
    try {
      const inv = await authService.resolveInvitation(code);
      router.replace(`/signup?token=${encodeURIComponent(inv.token)}`);
    } catch (err) {
      const message =
        err instanceof NotFoundError
          ? 'Invite code not found'
          : err instanceof Error
            ? err.message
            : 'Could not resolve invite';
      toast.error(message);
    }
  };

  const inviteCodeCard = (
    <Card>
      <CardHeader>
        <CardTitle>Sign up with an invite</CardTitle>
        <CardDescription>
          Enter the code your administrator gave you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="e.g. ABCD1234"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookup();
            }
          }}
        />
        <Button className="w-full" onClick={lookup}>
          Continue
        </Button>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {boot.publicSignup ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setShowCodeEntry(false)}
          >
            <ArrowLeft className="mr-2 size-4" /> Request access instead
          </Button>
        ) : (
          <Button variant="ghost" size="sm" asChild className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 size-4" /> Back to sign in
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );

  // ----- open signup (pending approval) -----
  if (boot.publicSignup) {
    if (showCodeEntry) return inviteCodeCard;
    if (pendingSubmitted) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" />
              Account created
            </CardTitle>
            <CardDescription>
              Your account is pending. An administrator needs to approve it
              before you can sign in — ask them to check Settings → Users.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="ghost" size="sm" asChild className="w-full">
              <Link href="/login">
                <ArrowLeft className="mr-2 size-4" /> Back to sign in
              </Link>
            </Button>
          </CardFooter>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>
            New accounts are pending until an administrator approves them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...registerForm}>
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
              <FormField
                control={registerForm.control}
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
                control={registerForm.control}
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
                control={registerForm.control}
                name="passcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passcode</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormDescription>
                      At least 8 characters with a letter and a number.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={registerForm.formState.isSubmitting}
              >
                {registerForm.formState.isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Request access
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button variant="ghost" size="sm" asChild className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 size-4" /> Back to sign in
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setShowCodeEntry(true)}
          >
            I have an invite code
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // ----- invite-only -----
  return inviteCodeCard;
}

export default function SignupPage() {
  // useSearchParams must be inside Suspense per Next 15 static-generation rules.
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <SignupInner />
    </Suspense>
  );
}
