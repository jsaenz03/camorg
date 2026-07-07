/**
 * PhotoMetadataForm Component
 *
 * Form for entering photo metadata: patient name, body part, subpart, clinical notes.
 * Uses react-hook-form + Zod validation + shadcn/ui components.
 */

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { BodyPart, BodyPartLabels } from '@/types/body-part';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * Form schema for photo metadata
 * (subset of photoRecordCreateSchema - only user-editable fields)
 */
const photoMetadataFormSchema = z.object({
  patientName: z
    .string()
    .min(1, 'Patient name is required')
    .max(100, 'Patient name must be 100 characters or less')
    .trim(),
  bodyPart: z.nativeEnum(BodyPart, {
    message: 'Please select a body part',
  }),
  subpart: z
    .string()
    .max(100, 'Subpart must be 100 characters or less')
    .optional()
    .or(z.literal('')),
  clinicalNotes: z
    .string()
    .max(2000, 'Clinical notes must be 2000 characters or less')
    .optional()
    .or(z.literal('')),
  /** Optional override of the capture date (for importing older photos). */
  capturedAt: z.date().optional(),
});

export type PhotoMetadataFormValues = z.infer<typeof photoMetadataFormSchema>;

interface PhotoMetadataFormProps {
  onSubmit: (data: PhotoMetadataFormValues) => void;
  onCancel?: () => void;
  defaultValues?: Partial<PhotoMetadataFormValues>;
  isSubmitting?: boolean;
}

export function PhotoMetadataForm({
  onSubmit,
  onCancel,
  defaultValues,
  isSubmitting = false,
}: PhotoMetadataFormProps) {
  const form = useForm<PhotoMetadataFormValues>({
    resolver: zodResolver(photoMetadataFormSchema),
    defaultValues: {
      patientName: defaultValues?.patientName || '',
      bodyPart: defaultValues?.bodyPart || undefined,
      subpart: defaultValues?.subpart || '',
      clinicalNotes: defaultValues?.clinicalNotes || '',
    },
  });

  const handleSubmit = (data: PhotoMetadataFormValues) => {
    // Transform empty strings to null for optional fields
    const transformedData = {
      ...data,
      subpart: data.subpart === '' ? null : data.subpart,
      clinicalNotes: data.clinicalNotes === '' ? null : data.clinicalNotes,
    };
    onSubmit(transformedData as PhotoMetadataFormValues);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Patient Name */}
        <FormField
          control={form.control}
          name="patientName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Patient Name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Enter patient name"
                  {...field}
                  disabled={isSubmitting}
                  autoFocus
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Body Part */}
        <FormField
          control={form.control}
          name="bodyPart"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Body Part <span className="text-destructive">*</span>
              </FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select body part" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.values(BodyPart).map((bodyPart) => (
                    <SelectItem key={bodyPart} value={bodyPart}>
                      {BodyPartLabels[bodyPart]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Subpart */}
        <FormField
          control={form.control}
          name="subpart"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subpart (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., left anterior, medial aspect"
                  {...field}
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormDescription>
                Specify the anatomical detail or region within the body part
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Clinical Notes */}
        <FormField
          control={form.control}
          name="clinicalNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Clinical Notes (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Enter clinical observations, findings, or context..."
                  className="resize-none min-h-32"
                  {...field}
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormDescription>
                {field.value?.length || 0}/2000 characters
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Capture Date (optional override) */}
        <FormField
          control={form.control}
          name="capturedAt"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Capture Date (Optional)</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      disabled={isSubmitting}
                      className={cn(
                        'w-full justify-between text-left font-normal',
                        !field.value && 'text-muted-foreground',
                      )}
                    >
                      {field.value ? (
                        format(field.value, 'd MMM yyyy')
                      ) : (
                        'Use actual capture time'
                      )}
                      <CalendarIcon className="size-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                  />
                </PopoverContent>
              </Popover>
              <FormDescription>
                Back-date this photo, e.g. when importing an older capture.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Photo'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
