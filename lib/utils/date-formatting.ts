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
