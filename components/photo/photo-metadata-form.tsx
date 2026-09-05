/**
 * PhotoMetadataForm Component
 *
 * Form for entering photo metadata: patient name, body part, subpart, clinical notes.
 * Uses react-hook-form + Zod validation + shadcn/ui components.
 */

'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { CalendarIcon, Loader2 } from 'lucide-react';
import {
  BodyPart,
  BodyPartLabels,
  BILATERAL_BODY_PARTS,
} from '@/types/body-part';
import { parseDobInput } from '@/lib/utils/date-formatting';
import { BodyMapPicker } from '@/components/patient/body-map-picker';
import { DobInput } from '@/components/patient/dob-input';
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
  /** Optional date of birth for a newly created patient (free text, parsed). */
  patientDob: z
    .string()
    .refine(
      (v) => !v.trim() || parseDobInput(v) !== null,
      'Enter a valid date, e.g. 4/2/85 or 04/02/1985',
    ),
  bodyPart: z.nativeEnum(BodyPart, {
    message: 'Please select a body part',
  }),
  /** Patient's side for bilateral regions; unset for central ones. */
  laterality: z.enum(['left', 'right']).optional(),
  subpart: z
    .string()
    .max(100, 'Subpart must be 100 characters or less')
    .optional()
    .or(z.literal('')),
  /** Exact X mark from the body map: normalized 0..1 + which diagram + face. */
  pinX: z.number().min(0).max(1).optional(),
  pinY: z.number().min(0).max(1).optional(),
  pinSpace: z.enum(['body', 'part']).optional(),
  pinView: z.enum(['front', 'back']).optional(),
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
  /**
   * Freeze the patient name/DOB fields. Set by the upload dialog, which
   * saves to a fixed patient — an edit there used to look accepted while
   * being silently ignored (wrong-patient filing risk).
   */
  patientLocked?: boolean;
}

export function PhotoMetadataForm({
  onSubmit,
  onCancel,
  defaultValues,
  isSubmitting = false,
  patientLocked = false,
}: PhotoMetadataFormProps) {
  const form = useForm<PhotoMetadataFormValues>({
    resolver: zodResolver(photoMetadataFormSchema),
    defaultValues: {
      patientName: defaultValues?.patientName || '',
      patientDob: defaultValues?.patientDob || '',
      bodyPart: defaultValues?.bodyPart || undefined,
      laterality: defaultValues?.laterality,
      subpart: defaultValues?.subpart || '',
      pinX: defaultValues?.pinX,
      pinY: defaultValues?.pinY,
      pinSpace: defaultValues?.pinSpace,
      pinView: defaultValues?.pinView,
      clinicalNotes: defaultValues?.clinicalNotes || '',
    },
  });

  // Laterality only makes sense for paired regions — clear it when the part
  // changes to a central one so a stale side never reaches the database.
  const bodyPartValue = form.watch('bodyPart');
  const isBilateral = bodyPartValue ? BILATERAL_BODY_PARTS.has(bodyPartValue) : false;
  useEffect(() => {
    if (bodyPartValue && !BILATERAL_BODY_PARTS.has(bodyPartValue)) {
      if (form.getValues('laterality')) form.setValue('laterality', undefined);
    }
  }, [bodyPartValue, form]);

  // The X mark belongs to the part (and its diagram) it was placed on — drop
  // it whenever the part or side changes outside the body map.
  const clearPin = () => {
    form.setValue('pinX', undefined, { shouldDirty: true });
    form.setValue('pinY', undefined, { shouldDirty: true });
    form.setValue('pinSpace', undefined, { shouldDirty: true });
    form.setValue('pinView', undefined, { shouldDirty: true });
  };
  const pinX = form.watch('pinX');
  const pinY = form.watch('pinY');
  const pinSpace = form.watch('pinSpace');
  const pinView = form.watch('pinView');
  const activePin =
    pinX !== undefined && pinY !== undefined && pinSpace !== undefined
      ? { x: pinX, y: pinY, space: pinSpace, view: pinView ?? 'front' }
      : null;

  const handleSubmit = (data: PhotoMetadataFormValues) => {
    // Transform empty strings to null for optional fields
    const transformedData = {
      ...data,
      laterality: isBilateral ? (data.laterality ?? null) : null,
      subpart: data.subpart === '' ? null : data.subpart,
      clinicalNotes: data.clinicalNotes === '' ? null : data.clinicalNotes,
      pinX: data.pinX ?? null,
      pinY: data.pinY ?? null,
      pinSpace: data.pinSpace ?? null,
      pinView: data.pinView ?? null,
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
                  Patient name <span className="text-destructive">*</span>
                </FormLabel>
              <FormControl>
                <Input
                  placeholder="Enter patient name"
                  {...field}
                  disabled={isSubmitting}
                  readOnly={patientLocked}
                  autoFocus
                />
              </FormControl>
              {patientLocked ? (
                <FormDescription>Fixed — this photo saves to the open patient&rsquo;s file.</FormDescription>
              ) : (
                <FormMessage />
              )}
            </FormItem>
          )}
        />

        {/* Patient Date of Birth (optional, used when creating the patient) */}
        <FormField
          control={form.control}
          name="patientDob"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date of birth</FormLabel>
              <FormControl>
                <DobInput
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={isSubmitting || patientLocked}
                />
              </FormControl>
              {!patientLocked && (
                <FormDescription>
                  Optional — type it (e.g. 4/2/85) or use the calendar. Enables search by date of birth.
                </FormDescription>
              )}
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
                Body part <span className="text-destructive">*</span>
              </FormLabel>
              <div className="flex gap-2">
                <Select
                  onValueChange={(v) => {
                    field.onChange(v);
                    clearPin();
                  }}
                  value={field.value ?? ''}
                  disabled={isSubmitting}
                >
                  <FormControl>
                    {/* flex-1: the trigger must fill the row — the default w-fit
                        resizes with the selected label and shoves the body-map
                        button sideways on every change. */}
                    <SelectTrigger className="min-w-0 flex-1">
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
                <BodyMapPicker
                  value={field.value}
                  laterality={form.watch('laterality') ?? null}
                  pin={activePin}
                  onPinChange={(p) => {
                    form.setValue('pinX', p?.x, { shouldDirty: true });
                    form.setValue('pinY', p?.y, { shouldDirty: true });
                    form.setValue('pinSpace', p?.space, { shouldDirty: true });
                    form.setValue('pinView', p?.view, { shouldDirty: true });
                  }}
                  onSelect={(part, side) => {
                    field.onChange(part);
                    form.setValue('laterality', side ?? undefined, { shouldDirty: true });
                  }}
                  disabled={isSubmitting}
                />
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Side comes from the body map: tapping a bilateral region (or its
            detail diagram) sets the patient's side — no separate control. */}

        {/* Subpart */}
        <FormField
          control={form.control}
          name="subpart"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subpart</FormLabel>
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
              <FormLabel>Clinical notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Enter clinical observations, findings, or context…"
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
              <FormLabel>Capture date</FormLabel>
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
                Saving…
              </>
            ) : (
              'Save photo'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
