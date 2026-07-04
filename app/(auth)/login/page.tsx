'use client';

/**
 * Login screen.
 *
 * - Username + passcode form (react-hook-form + zod).
 * - On success: refresh the auth context and redirect to /capture.
 * - Dev seed button: visible only when NODE_ENV=development AND zero users.
 * - Link to /signup (which itself enforces the invite-only setting).
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
import { useAuth } from '@/lib/auth/auth-context';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [userCount, setUserCount] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);

  const isDev = process.env.NODE_ENV === 'development';

  useEffect(() => {
    if (!isDev) return;
    void authService
      .countUsers()
      .then(setUserCount)
      .catch(() => setUserCount(null));
  }, [isDev]);

  const form = useForm<ClinicianLogin>({
    resolver: zodResolver(clinicianLoginSchema),
    defaultValues: { username: '', passcode: '' },
  });

  async function onSubmit(values: ClinicianLogin) {
    try {
      await authService.login(values);
      await refresh();
      router.replace('/capture');
    } catch (err) {
      const message =
        err instanceof InvalidCredentialsError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Login failed';
      toast.error(message);
    }
  }

  async function handleSeed() {
    setSeeding(true);
    try {
      await authService.seedDevAdmin();
      toast.success('Dev admin created. Username: admin · Passcode: devpass123');
      form.setValue('username', 'admin');
      form.setValue('passcode', 'devpass123');
      setUserCount(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }

  const showSeed = isDev && userCount === 0;

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

        {showSeed && (
          <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">No users found (dev mode)</p>
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
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/signup" className="flex items-center justify-center gap-2">
            <UserPlus className="size-4" />
            Sign up with invite
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
