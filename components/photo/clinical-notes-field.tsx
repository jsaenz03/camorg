'use client';

/**
 * ClinicalNotesField — the clinical-notes input shared by capture/upload
 * (PhotoMetadataForm) and the photo detail dialog.
 *
 * Documentation helpers, deliberately low-key:
 * - A small "Quick text" button beside the label opens the clinician's own
 *   note templates; picking one inserts at the cursor and bumps its usage
 *   so the most-used float to the top.
 * - Typing a template's shortcut then Space expands it in place
 *   (lib/utils/text-expansion). Shortcuts only exist for templates the
 *   clinician defined, so expansion is opt-in by construction.
 * - {date} {patient} {bodypart} tokens resolve at insertion; a value the
 *   caller doesn't have stays literal, never silently dropped.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import type { NoteTemplate } from '@/types/note-template';
import { useAuth } from '@/lib/auth/auth-context';
import { noteTemplateService } from '@/lib/services/note-template-service';
import { STARTER_TEMPLATES } from '@/lib/utils/note-template-starters';
import { resolveNoteTokens } from '@/lib/utils/note-tokens';
import { expandShortcutAtCaret } from '@/lib/utils/text-expansion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

const MAX_NOTES = 2000;

/** Picker row: a saved template, or the starter set as a client-side
 *  fallback when listing failed (e.g. a read-only licence blocked seeding).
 *  id null = nothing to record usage against. */
interface TemplateOption {
  id: string | null;
  title: string;
  body: string;
  shortcut: string | null;
}

function toOption(t: NoteTemplate): TemplateOption {
  return { id: t.id, title: t.title, body: t.body, shortcut: t.shortcut };
}

const STARTER_OPTIONS: TemplateOption[] = STARTER_TEMPLATES.map((t) => ({
  id: null,
  title: t.title,
  body: t.body,
  shortcut: null,
}));

// Stable empty list so memo deps don't churn while templates are loading.
const EMPTY_OPTIONS: TemplateOption[] = [];

interface ClinicalNotesFieldProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Token sources; missing values leave their token literal in the note. */
  patientName?: string | null;
  bodyPartLabel?: string | null;
  /** Validation message slot (react-hook-form FormMessage in the capture form). */
  error?: React.ReactNode;
}

export function ClinicalNotesField({
  id,
  value,
  onChange,
  disabled = false,
  patientName,
  bodyPartLabel,
  error,
}: ClinicalNotesFieldProps) {
  const { clinician } = useAuth();
  const clinicianId = clinician?.id;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);

  useEffect(() => {
    if (!clinicianId) return;
    let mounted = true;
    noteTemplateService
      .listTemplates(clinicianId)
      .then((list) => {
        if (mounted) setTemplates(list.map(toOption));
      })
      .catch(() => {
        // Listing itself failed (not merely an empty list): the starter set
        // is better than an empty picker.
        if (mounted) setTemplates(STARTER_OPTIONS);
      });
    return () => {
      mounted = false;
    };
  }, [clinicianId]);

  const options = templates ?? EMPTY_OPTIONS;

  const tokenValues = useMemo(
    () => ({ patient: patientName ?? null, bodyPart: bodyPartLabel ?? null }),
    [patientName, bodyPartLabel],
  );

  /** Shortcut → body with tokens pre-resolved, plus the lookup back to the
   *  template row so expansions can record usage. */
  const { shortcuts, byShortcut } = useMemo(() => {
    const shortcuts: Record<string, string> = {};
    const byShortcut = new Map<string, TemplateOption>();
    for (const t of options) {
      if (!t.shortcut) continue;
      const key = t.shortcut.toLowerCase();
      // Expansion fires on the Space keystroke and consumes it, so the
      // replacement re-adds the space the clinician typed.
      shortcuts[key] = resolveNoteTokens(t.body, tokenValues) + ' ';
      byShortcut.set(key, t);
    }
    return { shortcuts, byShortcut };
  }, [options, tokenValues]);

  const recordUsage = useCallback(
    (id: string | null) => {
      if (!id || !clinicianId) return;
      noteTemplateService.recordUsage(clinicianId, id).catch(() => {});
    },
    [clinicianId],
  );

  /** Replace the current selection (usually an empty one) with `raw`. */
  const insertAtCursor = useCallback(
    (raw: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? start;
      const resolved = resolveNoteTokens(raw, tokenValues);
      const next = value.slice(0, start) + resolved + value.slice(end);
      if (next.length > MAX_NOTES) {
        toast.error('That template would push the note past 2000 characters');
        return;
      }
      onChange(next);
      // The textarea is controlled — wait for the DOM to catch up, then put
      // the caret where the inserted text ends.
      requestAnimationFrame(() => {
        const pos = start + resolved.length;
        textareaRef.current?.setSelectionRange(pos, pos);
        textareaRef.current?.focus();
      });
    },
    [value, onChange, tokenValues],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== ' ' || e.shiftKey) return;
    if (Object.keys(shortcuts).length === 0) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const outcome = expandShortcutAtCaret({
      text: value,
      caret: el.selectionStart,
      shortcuts,
      maxLength: MAX_NOTES,
    });
    if (!outcome) return;
    if (outcome.applied) {
      e.preventDefault();
      onChange(outcome.text);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(outcome.caret, outcome.caret);
      });
      recordUsage(byShortcut.get(outcome.shortcut)?.id ?? null);
    } else {
      // Keep the space the user typed; just explain why nothing expanded.
      toast.error('Shortcut matched, but the note would exceed 2000 characters');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>Clinical notes</Label>
        {/* modal: this field always lives inside a Radix Dialog, and a
            non-modal popover's portaled content sits outside the dialog's
            scroll-lock — hover and clicks work but the wheel is swallowed,
            so the template list can't scroll (shadcn documents the same
            fix for its combobox-in-dialog pattern). */}
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              disabled={disabled}
              aria-label="Insert a note template"
            >
              <Sparkles className="size-3.5" />
              Quick text
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1">
            {!templates ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : options.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No templates yet — add your own under Settings → Templates.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto overscroll-contain">
                {options.map((t) => (
                  <button
                    key={t.id ?? t.title}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setOpen(false);
                      insertAtCursor(t.body);
                      recordUsage(t.id);
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.title}</span>
                      {t.shortcut && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {t.shortcut}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {t.body}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
              Type a shortcut then Space to expand it. {'{date}'} {'{patient}'} {'{bodypart}'} fill in
              automatically.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter clinical observations, findings, or context…"
        className="min-h-32 resize-none"
        maxLength={MAX_NOTES}
        disabled={disabled}
      />
      <p className="text-right text-xs text-muted-foreground">
        {value.length}/{MAX_NOTES}
      </p>
      {error}
    </div>
  );
}
