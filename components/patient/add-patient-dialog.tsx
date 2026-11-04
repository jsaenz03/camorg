/**
 * AddPatientDialog
 *
 * Creates a patient file without going through capture or the phone
 * companion: name is required, date of birth and email are optional. An exact
 * name that already exists asks before creating a second record with the same
 * name — the same fragment guard the capture and upload flows apply.
 */

'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Patient } from '@/types/patient';
import { patientService } from '@/lib/services/patient-service';
import { parseDobInput } from '@/lib/utils/date-formatting';
import { confirmDialog } from '@/lib/utils/confirm';
import { DobInput } from '@/components/patient/dob-input';
import { Button } from '@/components/ui/button';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const addPatientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Patient name is required')
    .max(100, 'Patient name must be 100 characters or less'),
  dateOfBirth: z
    .string()
    .refine(
      (v) => !v.trim() || parseDobInput(v) !== null,
      'Enter a valid date, e.g. 4/2/85 or 04/02/1985',
    ),
  email: z
    .string()
    .trim()
    .max(254, 'Email must be 254 characters or less')
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
});

type AddPatientValues = z.infer<typeof addPatientSchema>;

interface AddPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new patient after it is created. */
  onCreated: (patient: Patient) => void;
}

export function AddPatientDialog({ open, onOpenChange, onCreated }: AddPatientDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const form = useForm<AddPatientValues>({
    resolver: zodResolver(addPatientSchema),
    defaultValues: { name: '', dateOfBirth: '', email: '' },
  });

  // A fresh open starts clean — a cancelled half-typed name should not come
  // back the next time the dialog is opened.
  useEffect(() => {
    if (open) {
      form.reset({ name: '', dateOfBirth: '', email: '' });
    }
  }, [open, form]);

  const handleSubmit = async (values: AddPatientValues) => {
    setIsSaving(true);
    try {
      // Two records with one name fragment the photo history; the service
      // only warns, so ask here where the user can still stop.
      if (
        (await patientService.isDuplicateName(values.name)) &&
        !(await confirmDialog(
          `Another patient is already named “${values.name}”.\n\n` +
            'Create a separate patient with the same name?',
        ))
      ) {
        return;
      }

      const created = await patientService.createPatient({
        name: values.name,
        dateOfBirth: parseDobInput(values.dateOfBirth),
        email: values.email,
      });
      toast.success(`${created.name} added`);
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Failed to add patient: ${error.message}`
          : 'Failed to add patient. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      {/* Bounded dialog: header and action bar stay put, the form scrolls
          between them — the action never leaves the window on short screens. */}
      <DialogContent className="flex max-h-[95dvh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Add patient</DialogTitle>
          <DialogDescription>
            Create a patient file. Capture or upload photos from their file once
            it exists.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex min-h-0 flex-1 flex-col">
            {/* Full-bleed scroll region — px-6 restores the dialog's inset. */}
            <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
            <div className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Patient name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isSaving} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of birth</FormLabel>
                  <FormControl>
                    <DobInput
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      disabled={isSaving}
                    />
                  </FormControl>
                  <FormDescription>
                    Optional — type it (e.g. 4/2/85) or use the calendar. Enables
                    search by date of birth.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (optional)</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} disabled={isSaving} />
                  </FormControl>
                  <FormDescription>
                    Used only to prefill the recipient when you email a report
                    draft. Leave blank for none.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            </div>
            </div>

            <DialogFooter className="shrink-0 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  'Add patient'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
