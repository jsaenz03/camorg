/**
 * Date Formatting Utilities
 *
 * Provides consistent date formatting across the application.
 */

import { format, formatDistanceToNow, isValid, parse } from 'date-fns';

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
 * the canonical storage form of the patients.dob column. Both entry (calendar
 * picker, local midnight) and search parsing funnel through here so equality
 * matching survives timezone shifts.
 * ponytail: matches whole days only; partial-date search (month/year) would
 * need a range query in patient-service.
 */
export function dobToMs(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Parses a patient-search term as a date of birth. Accepts ISO (yyyy-MM-dd)
 * and Australian (d/M/yyyy) formats; returns null when the term is not a
 * well-formed, real calendar date (e.g. 31/02/1990).
 */
export function parseDobSearchTerm(term: string): Date | null {
  const t = term.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = parse(t, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : null;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
    const d = parse(t, 'd/M/yyyy', new Date());
    return isValid(d) ? d : null;
  }
  return null;
}
