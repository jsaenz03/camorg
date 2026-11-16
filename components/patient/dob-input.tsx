/**
 * DobInput
 *
 * Manual date-of-birth entry with a fallback calendar picker. Typing is the
 * primary path (a birth year decades back is painful to scroll to in a
 * calendar). The text is parsed live, normalised to dd/MM/yyyy on blur, and
 * flagged with aria-invalid while it can't be parsed; picking a date writes
 * the canonical text form.
 */

'use client';

import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { parseDobInput } from '@/lib/utils/date-formatting';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DobInputProps {
  /** Raw text; the parent (form) owns it. Empty string = no date recorded. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  className?: string;
}

export function DobInput({
  value,
  onChange,
  onBlur,
  disabled,
  className,
}: DobInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const parsed = value.trim() ? parseDobInput(value) : null;
  const invalid = value.trim() !== '' && !parsed;

  // Collide against the dialog card when the picker opens inside one (the
  // popover portals to the body, so Radix's default viewport boundary lets
  // the calendar run past the dialog's bottom edge on short windows —
  // measured 42px past the dialog and 29px off-screen at 900×520). Clamped
  // to the space the boundary leaves, a short window scrolls the calendar
  // inside the popover instead.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<HTMLElement | undefined>(undefined);

  function handlePickerOpen(open: boolean) {
    setBoundary(
      open
        ? (triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? undefined)
        : undefined,
    );
    setPickerOpen(open);
  }

  function handleBlur() {
    // Echo the canonical form back so the user sees how it was read.
    if (parsed) onChange(format(parsed, 'dd/MM/yyyy'));
    onBlur?.();
  }

  return (
    <div className={className ?? 'flex gap-2'}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder="e.g. 4/2/85 or 04/02/1985"
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1"
      />
      <Popover open={pickerOpen} onOpenChange={handlePickerOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            disabled={disabled}
            aria-label="Pick date of birth"
          >
            <CalendarIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto max-h-(--radix-popover-content-available-height) overflow-y-auto p-0"
          align="end"
          collisionBoundary={boundary}
        >
          <Calendar
            mode="single"
            selected={parsed ?? undefined}
            onSelect={(d) => {
              if (d) onChange(format(d, 'dd/MM/yyyy'));
              setPickerOpen(false);
            }}
            disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
