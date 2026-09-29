/**
 * Pure mapper from attention items to the OS-level notification summary.
 *
 * The OS toast is deliberately generic — counts only, never patient names
 * or dates — because notification centre / lock-screen previews are visible
 * to anyone at the machine. The in-app dashboard keeps the detailed list.
 *
 * Dependency-free (aside from the item type) so it is unit-checkable:
 * tests/os-alert-summary.spec.ts.
 */
import type { AttentionItem, AttentionKind } from '@/lib/services/notification-service';

/** Kinds that may raise an OS alert. signup-pending is an admin workflow,
 *  not a clinical alert, and never buzzes the notification centre. */
const ALERTING_KINDS = [
  'review-overdue',
  'review-due-soon',
  'review-stale',
  'photo-review-overdue',
  'photo-review-due-soon',
  'consent-expired',
] as const;

export type AlertingKind = (typeof ALERTING_KINDS)[number];

const LABELS: Record<AlertingKind, { one: string; many: string }> = {
  'review-overdue': { one: 'review overdue', many: 'reviews overdue' },
  'review-due-soon': { one: 'review due soon', many: 'reviews due soon' },
  'review-stale': { one: 'patient gone stale', many: 'patients gone stale' },
  'photo-review-overdue': { one: 'photo review overdue', many: 'photo reviews overdue' },
  'photo-review-due-soon': { one: 'photo review due soon', many: 'photo reviews due soon' },
  'consent-expired': { one: 'expired consent', many: 'expired consents' },
};

export interface OsAlertSummary {
  /** Sorted ids of the current alerting items — the dedupe key set: an id
   *  appearing here that wasn't in the last snapshot means "something new
   *  needs attention". Ids only (kind:patientId), never names. */
  ids: string[];
  title: string;
  /** e.g. "2 reviews overdue · 3 reviews due soon". Counts only. */
  body: string;
}

function plural(n: number, labels: { one: string; many: string }): string {
  return `${n} ${n === 1 ? labels.one : labels.many}`;
}

function isAlertingKind(kind: AttentionKind): kind is AlertingKind {
  return (ALERTING_KINDS as readonly string[]).includes(kind);
}

/** Null when there is nothing clinical to alert on. */
export function summariseForOsAlerts(items: AttentionItem[]): OsAlertSummary | null {
  const counts = new Map<AlertingKind, number>();
  for (const item of items) {
    if (!isAlertingKind(item.kind)) continue;
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const parts: string[] = [];
  let total = 0;
  for (const kind of ALERTING_KINDS) {
    const n = counts.get(kind);
    if (!n) continue;
    total += n;
    parts.push(plural(n, LABELS[kind]));
  }
  return {
    ids: items
      .filter((i) => isAlertingKind(i.kind))
      .map((i) => i.id)
      .sort(),
    title:
      total === 1
        ? 'Camog — 1 item needs attention'
        : `Camog — ${total} items need attention`,
    body: parts.join(' · '),
  };
}
