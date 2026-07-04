'use client';

/**
 * Change-passcode form. Used on the settings page (and forced after a
 * temp-passcode login via the dashboard gate banner).
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import {
  changePasscodeSchema,
  type ChangePasscode,
} from '@/lib/validators/schemas';
import { authService } from '@/lib/services/auth-service';
import { InvalidCredentialsError } from '@/lib/validators/errors';

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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function ChangePasscodeForm({ onchanged }: { onchanged?: () => void }) {
  const form = useForm<ChangePasscode>({
    resolver: zodResolver(changePasscodeSchema),
    defaultValues: {
      currentPasscode: '',
      newPasscode: '',
      confirmPasscode: '',
    },
  });

  async function onSubmit(values: ChangePasscode) {
    try {
      await authService.changePasscode(values.currentPasscode, values.newPasscode);
      toast.success('Passcode updated');
      form.reset();
      onchanged?.();
    } catch (err) {
      const message =
        err instanceof InvalidCredentialsError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not change passcode';
      toast.error(message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passcode</CardTitle>
        <CardDescription>Use at least 8 characters with a letter and a number.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="currentPasscode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current passcode</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPasscode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New passcode</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPasscode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new passcode</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Update passcode
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
