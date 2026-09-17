/**
 * Token substitution for note templates.
 *
 * {date} → today, DD/MM/YYYY (AU clinical convention)
 * {patient} → patient name, when the caller knows it
 * {bodypart} → body-part label, when the caller knows it
 *
 * A token whose value is unknown stays literal — nothing is silently
 * dropped from a clinical note.
 */

import { format } from 'date-fns';

export interface NoteTokenValues {
  patient?: string | null;
  bodyPart?: string | null;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

export function resolveNoteTokens(text: string, values: NoteTokenValues = {}): string {
  const date = format(values.now ?? new Date(), 'dd/MM/yyyy');
  return text
    .replaceAll('{date}', date)
    .replaceAll('{patient}', values.patient?.trim() || '{patient}')
    .replaceAll('{bodypart}', values.bodyPart?.trim() || '{bodypart}');
}
