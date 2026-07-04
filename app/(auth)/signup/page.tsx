'use client';

/**
 * Signup screen.
 *
 * Three modes:
 *  1. `?token=XXXX` — invite-token flow: resolve the invitation, prefill
 *     username/displayName, set a fresh passcode, accept the invitation.
 *  2. No token + `allow_public_signup` — open registration.
 *  3. No token + invite-only — show an inline code field; on submit, resolve
 *     the invitation and switch to mode 1.
 *
 * On success: refresh the auth context and redirect to /capture (or /settings
 * if `mustChangePasscode` is true, which is rare for token invites).
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';

import {
  clinicianRegisterSchema,
  invitationAcceptSchema,
  type ClinicianRegister,
  type InvitationAccept,
} from '@/lib/validators/schemas';
import { authService } from '@/lib/services/auth-service';
import { useAuth } from '@/lib/auth/auth-context';
import { AlreadyExistsError, NotFoundError } from '@/lib/validators/errors';
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
import { Button } from '@/components/ui/button';

function SignupInner() {
  const router = useRouter();
  const { refresh } = useAuth();
  const params = useSearchParams();
  const tokenParam = params.get('token')?.trim() ?? '';

  const [publicSignup, setPublicSignup] = useState<boolean | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');

  useEffect(() => {
    void authService
      .getSettings()
      .then((s) => setPublicSignup(s.allowPublicSignup))
      .catch(() => setPublicSignup(false));
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
      router.replace('/capture');
    } catch (err) {
      const message =
        err instanceof AlreadyExistsError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Sign up failed';
      toast.error(message);
    }
  }

  // ----- open-signup form (allow_public_signup=true, no token) -----
  const registerForm = useForm<ClinicianRegister>({
    resolver: zodResolver(clinicianRegisterSchema),
    defaultValues: { username: '', displayName: '', passcode: '' },
  });

  async function onRegister(values: ClinicianRegister) {
    try {
      await authService.register(values);
      await refresh();
      toast.success('Account created');
      router.replace('/capture');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign up failed');
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
                      <Input type="password" autoComplete="new-password" {...field} />
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

  // No token. Either open signup, or invite-only prompt.
  if (publicSignup === null) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </CardContent>
      </Card>
    );
  }

  if (!publicSignup) {
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

    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign up</CardTitle>
          <CardDescription>
            Sign up is invite-only. Enter the code your administrator gave you.
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

  // Open signup
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Open registration is enabled</CardDescription>
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
                    <Input type="password" autoComplete="new-password" {...field} />
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
              Create account
            </Button>
          </form>
        </Form>
      </CardContent>
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

export default function SignupPage() {
  // useSearchParams must be inside Suspense per Next 15 static-generation rules.
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <SignupInner />
    </Suspense>
  );
}
