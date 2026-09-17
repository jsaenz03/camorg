/**
 * Type-a-shortcut expansion for text fields (TextExpander-style).
 *
 * Pure logic so it is directly testable: given the field text, the caret and
 * a shortcut → replacement map, decide what (if anything) expands when the
 * user presses the trigger key (Space). The caller owns the key event and
 * applies the result to its own state.
 */

export interface ExpansionInput {
  text: string;
  caret: number;
  /** Lowercased shortcut → resolved replacement text. */
  shortcuts: Record<string, string>;
  /** Expansions that would push the text past this cap are refused. */
  maxLength?: number;
}

export type ExpansionOutcome =
  | { applied: true; text: string; caret: number; shortcut: string }
  | { applied: false; reason: 'too-long'; shortcut: string }
  // null = the word before the caret is not a shortcut; the keystroke proceeds.
  | null;

/** The characters a shortcut may contain (mirrors the schema's regex). */
const WORD_CHAR = /[A-Za-z0-9_-]/;

export function expandShortcutAtCaret({
  text,
  caret,
  shortcuts,
  maxLength = Number.POSITIVE_INFINITY,
}: ExpansionInput): ExpansionOutcome {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  // Only expand at a word boundary: the caret must sit right after the word
  // and right before whitespace/end — "ncp" in "ncp|plaque" must not fire.
  if (after.length > 0 && WORD_CHAR.test(after[0])) return null;

  let start = caret;
  while (start > 0 && WORD_CHAR.test(before[start - 1])) start--;
  if (start === caret) return null;

  const word = before.slice(start);
  const shortcut = word.toLowerCase();
  const body = shortcuts[shortcut];
  if (body === undefined) return null;

  const next = before.slice(0, start) + body + after;
  if (next.length > maxLength) {
    return { applied: false, reason: 'too-long', shortcut };
  }
  return { applied: true, text: next, caret: start + body.length, shortcut };
}
