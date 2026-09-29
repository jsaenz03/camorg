/**
 * Unit checks for the OS-toast summariser (lib/utils/os-alert-summary.ts).
 *
 * The OS notification must stay patient-free (notification centre and lock
 * screens are visible to anyone at the machine), cover only clinical kinds,
 * and expose stable ids for one-shot dedupe in os-alerts.ts. Playwright
 * compiles the TS import directly — no browser interaction needed.
 */
import { test, expect } from '@playwright/test';
import { summariseForOsAlerts } from '../lib/utils/os-alert-summary';
import type { AttentionItem } from '../lib/services/notification-service';

function item(id: string, kind: AttentionItem['kind'], title = 'Amina Fouad — review overdue'): AttentionItem {
  return { id, kind, severity: 'critical', title, detail: '', date: null, href: '/' };
}

test.describe('summariseForOsAlerts', () => {
  test('empty and non-clinical lists produce no alert', () => {
    expect(summariseForOsAlerts([])).toBeNull();
    // signup-pending is an admin workflow — never an OS alert.
    expect(summariseForOsAlerts([item('a', 'signup-pending')])).toBeNull();
  });

  test('groups counts and never leaks patient names or titles', () => {
    const summary = summariseForOsAlerts([
      item('p2', 'review-overdue'),
      item('p1', 'review-overdue'),
      item('p3', 'review-due-soon', 'Bob Smith — due soon'),
      item('p4', 'consent-expired'),
    ]);
    expect(summary).not.toBeNull();
    expect(summary!.body).toBe('2 reviews overdue · 1 review due soon · 1 expired consent');
    expect(summary!.body).not.toContain('Amina');
    expect(summary!.body).not.toContain('Bob');
    expect(summary!.title).toBe('Camog — 4 items need attention');
    expect(summary!.ids).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('singular counts read naturally', () => {
    const summary = summariseForOsAlerts([item('p1', 'photo-review-overdue')])!;
    expect(summary.body).toBe('1 photo review overdue');
    expect(summary.title).toBe('Camog — 1 item needs attention');
  });

  test('id set changes when an item clears, so dedupe re-arms', () => {
    const before = summariseForOsAlerts([
      item('p1', 'review-overdue'),
      item('p2', 'review-overdue'),
    ])!;
    const after = summariseForOsAlerts([item('p1', 'review-overdue')])!;
    expect(after.ids).not.toEqual(before.ids);
    expect(after.body).toBe('1 review overdue');
  });
});
