/**
 * Notification / attention service.
 *
 * Everything is DERIVED at read time from rows that already exist — review
 * dates, consent expiry, pending signups — so alerts appear and clear
 * without any background job (same pattern as consent status).
 *
 * The dashboard panel and the sidebar counters both read through here.
 * Recent actions come from the audit log via auditService.list(scope:'mine'),
 * not this service.
 */

import type { Patient } from '@/types/patient';
import { consentStatus, reviewStatus } from '@/types/patient';
import { photoReviewStatus } from '@/lib/utils/photo-review';
import { bodyPartDisplayLabel } from '@/types/body-part';
import { formatDistanceToNow } from 'date-fns';
import { patientService } from '@/lib/services/patient-service';
import { photoService, type PhotoReviewSummary } from '@/lib/services/photo-service';
import { getDB } from '@/lib/db/database';

export type AttentionKind =
  | 'review-overdue'
  | 'review-due-soon'
  | 'review-stale'
  | 'photo-review-overdue'
  | 'photo-review-due-soon'
  | 'consent-expired'
  | 'signup-pending';

export interface AttentionItem {
  /** Stable key for list rendering: `${kind}:${patientId|'app'}`. */
  id: string;
  kind: AttentionKind;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  /** The relevant date (due date / expiry), for sorting + tooltips. */
  date: Date | null;
  href: string;
}

export interface NotificationCounts {
  reviewOverdue: number;
  reviewDueSoon: number;
  reviewStale: number;
  photoReviewOverdue: number;
  photoReviewDueSoon: number;
  consentExpired: number;
  /** Awaiting-approval accounts; always 0 for non-admins. */
  pendingSignups: number;
  total: number;
}

/** Fired on window whenever a review-affecting action lands, so open
 *  consumers (sidebar, dashboard) refetch immediately instead of waiting
 *  for their poll tick. */
export const ATTENTION_CHANGED_EVENT = 'camog:attention-changed';

export function notifyAttentionChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ATTENTION_CHANGED_EVENT));
  }
}

/** Counter totals for the sidebar badges, derived from the item list. */
export function countsFromItems(items: AttentionItem[]): NotificationCounts {
  const counts: NotificationCounts = {
    reviewOverdue: 0,
    reviewDueSoon: 0,
    reviewStale: 0,
    photoReviewOverdue: 0,
    photoReviewDueSoon: 0,
    consentExpired: 0,
    pendingSignups: 0,
    total: items.length,
  };
  for (const item of items) {
    switch (item.kind) {
      case 'review-overdue':
        counts.reviewOverdue++;
        break;
      case 'review-due-soon':
        counts.reviewDueSoon++;
        break;
      case 'review-stale':
        counts.reviewStale++;
        break;
      case 'photo-review-overdue':
        counts.photoReviewOverdue++;
        break;
      case 'photo-review-due-soon':
        counts.photoReviewDueSoon++;
        break;
      case 'consent-expired':
        counts.consentExpired++;
        break;
      case 'signup-pending':
        counts.pendingSignups++;
        break;
    }
  }
  return counts;
}

class NotificationService {
  /** All current attention items, worst severity first. */
  async getAttentionItems(): Promise<AttentionItem[]> {
    const [patients, photoReviews, windows] = await Promise.all([
      patientService.getAllPatients(),
      photoService.getPhotosWithReviewDue(),
      this.getReviewWindows(),
    ]);

    const now = new Date();
    const items: AttentionItem[] = [];

    for (const p of patients) {
      items.push(...this.patientItems(p, windows, now));
    }

    // Scheduled per-photo reviews (migration 014), same derived alerting
    // as patient reviews but scoped to one photo / body part.
    for (const photo of photoReviews) {
      items.push(...this.photoReviewItems(photo, windows.warningDays, now));
    }

    // Pending signups are an admin-only, org-level item.
    const { accessService } = await import('@/lib/services/access-service');
    const me = await accessService.getCurrentClinician();
    if (me?.role === 'admin') {
      const pending = await this.countPendingSignups();
      if (pending > 0) {
        items.push({
          id: 'signup-pending:app',
          kind: 'signup-pending',
          severity: 'info',
          title:
            pending === 1
              ? '1 account awaiting approval'
              : `${pending} accounts awaiting approval`,
          detail: 'Approve or reject them in Settings → Users.',
          date: null,
          href: '/settings',
        });
      }
    }

    const severityRank = { critical: 0, warning: 1, info: 2 } as const;
    items.sort((a, b) => {
      if (severityRank[a.severity] !== severityRank[b.severity]) {
        return severityRank[a.severity] - severityRank[b.severity];
      }
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
    return items;
  }

  private patientItems(
    patient: Patient,
    windows: { warningDays: number; staleDays: number },
    now: Date,
  ): AttentionItem[] {
    const items: AttentionItem[] = [];
    const href = `/patients/view?id=${patient.id}`;
    const status = reviewStatus(patient, { ...windows, now });

    if (status === 'overdue' && patient.reviewDueAt) {
      items.push({
        id: `review-overdue:${patient.id}`,
        kind: 'review-overdue',
        severity: 'critical',
        title: `Review overdue — ${patient.name}`,
        detail: `Was due ${formatDistanceToNow(patient.reviewDueAt, { addSuffix: true })}.`,
        date: patient.reviewDueAt,
        href,
      });
    } else if (status === 'due-soon' && patient.reviewDueAt) {
      items.push({
        id: `review-due-soon:${patient.id}`,
        kind: 'review-due-soon',
        severity: 'warning',
        title: `Review due soon — ${patient.name}`,
        detail: `Scheduled ${formatDistanceToNow(patient.reviewDueAt, { addSuffix: true })}.`,
        date: patient.reviewDueAt,
        href,
      });
    } else if (status === 'stale') {
      // Same activity basis as reviewStatus (latest of review/capture, with
      // record creation as the floor) so the wording never claims the patient
      // has been quiet for longer than the status was derived from.
      const lastActivity = new Date(Math.max(
        patient.lastReviewedAt?.getTime() ?? 0,
        patient.lastPhotoAt?.getTime() ?? 0,
        patient.createdAt.getTime(),
      ));
      items.push({
        id: `review-stale:${patient.id}`,
        kind: 'review-stale',
        severity: 'warning',
        title: `Not reviewed in a while — ${patient.name}`,
        detail: `Last activity ${formatDistanceToNow(lastActivity, { addSuffix: true })} and no review scheduled.`,
        date: lastActivity,
        href,
      });
    }

    if (consentStatus(patient) === 'expired' && patient.consentExpiresAt) {
      items.push({
        id: `consent-expired:${patient.id}`,
        kind: 'consent-expired',
        severity: 'critical',
        title: `Consent expired — ${patient.name}`,
        detail: `Photo consent expired ${formatDistanceToNow(patient.consentExpiresAt, { addSuffix: true })}.`,
        date: patient.consentExpiresAt,
        href,
      });
    }

    return items;
  }

  /** One alert per photo whose scheduled review is due soon or overdue. */
  private photoReviewItems(
    photo: PhotoReviewSummary,
    warningDays: number,
    now: Date,
  ): AttentionItem[] {
    const status = photoReviewStatus(photo.reviewDueAt, { warningDays, now });
    if (status === 'none') return [];

    const href = `/patients/view?id=${photo.patientId}`;
    // "Left cheek · mole" — the spot the alert is about.
    const spot =
      bodyPartDisplayLabel(photo.bodyPart, photo.laterality) +
      (photo.subpart ? ` · ${photo.subpart}` : '');

    if (status === 'overdue') {
      return [
        {
          id: `photo-review-overdue:${photo.id}`,
          kind: 'photo-review-overdue',
          severity: 'critical',
          title: `Photo review overdue — ${photo.patientName}`,
          detail: `${spot} · was due ${formatDistanceToNow(photo.reviewDueAt, { addSuffix: true })}.`,
          date: photo.reviewDueAt,
          href,
        },
      ];
    }
    return [
      {
        id: `photo-review-due-soon:${photo.id}`,
        kind: 'photo-review-due-soon',
        severity: 'warning',
        title: `Photo review coming up — ${photo.patientName}`,
        detail: `${spot} · scheduled ${formatDistanceToNow(photo.reviewDueAt, { addSuffix: true })}.`,
        date: photo.reviewDueAt,
        href,
      },
    ];
  }

  /**
   * Review alert windows from the settings row. Read directly (not via
   * authService.getSettings) so the potentially-large logo blob doesn't ride
   * along on every sidebar poll. Falls back to the migration defaults when
   * the columns don't exist yet (pre-migration DB).
   */
  private async getReviewWindows(): Promise<{ warningDays: number; staleDays: number }> {
    try {
      const db = await getDB();
      const rows = await db.select<
        { review_warning_days: number; review_stale_days: number }[]
      >("SELECT review_warning_days, review_stale_days FROM settings WHERE id = 'app'");
      if (rows.length) {
        return {
          warningDays: rows[0].review_warning_days ?? 7,
          staleDays: rows[0].review_stale_days ?? 90,
        };
      }
    } catch {
      // fall through to defaults
    }
    return { warningDays: 7, staleDays: 90 };
  }

  private async countPendingSignups(): Promise<number> {
    const db = await getDB();
    const rows = await db.select<{ n: number }[]>(
      'SELECT COUNT(*) AS n FROM clinicians WHERE is_pending = 1',
    );
    return rows[0]?.n ?? 0;
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
