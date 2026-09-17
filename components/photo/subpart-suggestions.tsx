'use client';

/**
 * SubpartInput — the subpart text input plus usage-ranked suggestions drawn
 * from the clinician's own history (the `subparts` table, populated on every
 * photo save). Chips appear only when a body part is chosen, history exists,
 * and the clinician hasn't turned the helper off (showSubpartSuggestions).
 */

import { useEffect, useState } from 'react';

import type { BodyPart } from '@/types/body-part';
import type { SubpartSuggestion } from '@/types/subpart';
import { subpartService } from '@/lib/services/subpart-service';
import { Input } from '@/components/ui/input';

interface SubpartInputProps {
  id?: string;
  bodyPart: BodyPart | null | undefined;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Per-clinician preference; false hides the suggestion chips entirely. */
  enabled?: boolean;
}

// Same chip look as the lesion-series suggestions in the detail dialog.
const chipClass =
  'inline-flex items-center rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground';

export function SubpartInput({
  id,
  bodyPart,
  value,
  onChange,
  disabled = false,
  placeholder = 'e.g., left anterior, medial aspect',
  enabled = true,
}: SubpartInputProps) {
  const [suggestions, setSuggestions] = useState<SubpartSuggestion[]>([]);
  const [debouncedTerm, setDebouncedTerm] = useState('');

  // Debounce typing so suggestion searches don't run per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(value), 200);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (!enabled || !bodyPart) {
      setSuggestions([]);
      return;
    }
    let mounted = true;
    const term = debouncedTerm.trim();
    const query = term
      ? subpartService.searchSuggestions(bodyPart, term, 5)
      : subpartService.getSuggestionsForBodyPart(bodyPart, 5);
    query
      .then((list) => {
        if (mounted) setSuggestions(list);
      })
      .catch(() => {
        // Suggestions are best-effort; a failed lookup just hides the chips.
        if (mounted) setSuggestions([]);
      });
    return () => {
      mounted = false;
    };
  }, [enabled, bodyPart, debouncedTerm]);

  // Don't offer what's already typed.
  const visible = suggestions.filter((s) => s.displayText !== value.trim());

  return (
    <div>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={100}
      />
      {enabled && bodyPart && visible.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1.5">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(s.displayText)}
              title={`Use “${s.displayText}” (used ${s.usageCount} ${s.usageCount === 1 ? 'time' : 'times'} before)`}
              className={chipClass}
            >
              {s.displayText}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
