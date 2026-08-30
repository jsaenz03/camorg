/**
 * Date Formatting Utilities
 *
 * Provides consistent date formatting across the application.
 */

import { format, formatDistanceToNow } from 'date-fns';

/**
 * Formats a capture date for display in photo cards and timelines
 * @param date - The date to format
 * @returns Formatted date string (e.g., "Jan 15, 2025 at 2:30 PM")
 */
export function formatCaptureDate(date: Date): string {
  return format(date, 'MMM d, yyyy \'at\' h:mm a');
}

/**
 * Formats a date for timeline headers
 * @param date - The date to format
 * @returns Formatted date string (e.g., "January 15, 2025")
 */
export function formatTimelineDate(date: Date): string {
  return format(date, 'MMMM d, yyyy');
}

/**
 * Formats a relative time string (e.g., "2 hours ago", "3 days ago")
 * @param date - The date to format
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Formats the "last photo at" timestamp for patient cards
 * @param date - The date to format, or null if no photos
 * @returns Formatted string (e.g., "Last photo: 2 hours ago" or "No photos yet")
 */
export function formatLastPhotoTime(date: Date | null): string {
  if (!date) {
    return 'No photos yet';
  }
  return `Last photo: ${formatRelativeTime(date)}`;
}

/**
 * Formats a patient date of birth for display
 * @param date - The date of birth, or null when not recorded
 * @returns Formatted string (e.g., "24 Jan 1990") or null
 */
export function formatDateOfBirth(date: Date | null): string | null {
  if (!date) return null;
  return format(date, 'd MMM yyyy');
}

/**
 * Normalises a date of birth to unix ms at UTC midnight of its calendar date,
 * the canonical storage form of the patients.dob column. Both entry (manual
 * text, calendar picker) and search parsing funnel through here so equality
 * matching survives timezone shifts.
 * ponytail: matches whole days only; partial-date search (month/year alone)
 * would need a range query in patient-service.
 */
export function dobToMs(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Rebuilds a local-midnight Date from a stored dob value so the calendar date
 * survives display in any timezone (a bare new Date(ms) shifts a day in zones
 * behind UTC, which would then fail to match its own stored value on search).
 */
export function dobFromMs(ms: number): Date {
  const utc = new Date(ms);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * Aliases for the same UTC-midnight convention used by non-DOB day-precision
 * columns (patients.review_due_at) — same storage form, clearer call sites.
 */
export const dateToMs = dobToMs;
export const dateFromMs = dobFromMs;

/**
 * Expands a two-digit year to the most plausible four-digit one: 69–99 →
 * 1900s, 00–68 → 2000s (POSIX strptime pivot), then pulled back a century
 * when it would land in the future — a date of birth can't be.
 */
function expandTwoDigitYear(twoDigits: number): number {
  const year = twoDigits > 68 ? 1900 + twoDigits : 2000 + twoDigits;
  return year > new Date().getFullYear() ? year - 100 : year;
}

function buildDob(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null; // rolled over (e.g. 31/02/1990) or out of range
  }
  if (d.getTime() > Date.now()) return null; // not born yet
  if (d.getTime() < new Date(1900, 0, 1).getTime()) return null;
  return d;
}

/**
 * Parses a date of birth typed by a user, in a search box or a manual entry
 * field. Accepts Australian day-first dates with `/`, `-` or `.` separators
 * and two- or four-digit years (4/2/85 → 4 Feb 1985), plus year-first ISO
 * (1985-02-04). Returns null when the text is not a real, plausible date of
 * birth.
 */
export function parseDobInput(input: string): Date | null {
  const t = input.trim().replace(/[.\-]/g, '/');
  if (!t) return null;

  let m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (m) return buildDob(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const rawYear = m[3];
    const year = rawYear.length === 2 ? expandTwoDigitYear(+rawYear) : +rawYear;
    return buildDob(year, +m[2], +m[1]);
  }
  return null;
}
