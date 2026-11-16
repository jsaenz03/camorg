/**
 * Calendar-popover containment (browser-only smoke test).
 *
 * The DOB calendar popover portaled out of its dialog and ran past both the
 * dialog's bottom edge and the screen on short windows (measured 42px past
 * the dialog and 29px off-screen at 900×520): Radix's viewport boundary
 * can't help when below is the roomiest side, so nothing flipped. The
 * popover now collides against the dialog card itself when opened inside
 * one and clamps to the space it leaves (scrolling internally), the same
 * max-h pattern the Select primitive uses. Measured here at the reported
 * shape plus narrow and 130%-scale sizes.
 */
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __TAURI_INTERNALS__: Record<string, unknown>;
  }
}

const PATIENT_ROW = {
  id: 'p1', name: 'Joe Sample', normalized_name: 'joe sample', dob: null,
  photo_count: 2, deleted_photo_count: 0,
  created_at: Date.now() - 86400000, updated_at: Date.now() - 3600000,
  last_photo_at: Date.now() - 3600000, clinician_id: 'c1',
  is_archived: 0, archived_at: null, owner_clinician_id: 'c1', is_org_shared: 0,
  consent_given_at: null, consent_scope: null, consent_expires_at: null,
  review_due_at: null, last_reviewed_at: null, owner_name: 'Dr X',
};

async function openEditDialogCalendar(page: Page, uiScale: number): Promise<void> {
  await page.addInitScript(({ patientRow, scale }) => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    const state: { patient: Record<string, unknown> } = { patient: patientRow };
    const settings = { id: 'app', photos_dir: null, review_warning_days: 7, review_stale_days: 90, allow_public_signup: 1, logo: null, org_name: 'Clinic', session_timeout_ms: 1800000, idle_lock_timeout_ms: 300000 };
    const clinician = { id: 'c1', username: 'drx', display_name: 'Dr X', role: 'admin', is_active: 1, is_pending: 0, must_change_passcode: 0, preferences: scale ? JSON.stringify({ uiScale: scale }) : '{}', created_at: Date.now(), last_login_at: Date.now() };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      plugins: {},
      transformCallback: () => Math.floor(Math.random() * 1e6),
      invoke: (cmd: string, args?: { query?: string; values?: unknown[] }): Promise<unknown> => {
        const q = (args?.query || '').toLowerCase();
        if (cmd === 'plugin:sql|select') {
          if (q.includes('count(')) return Promise.resolve([{ n: 1 }]);
          if (q.includes('from settings')) return Promise.resolve([settings]);
          if (q.includes('from clinicians')) return Promise.resolve([clinician]);
          if (q.includes('from patients p')) return Promise.resolve(state.patient);
          if (q.includes('from photos')) return Promise.resolve([]);
          if (q.includes('from audit_log')) return Promise.resolve([]);
          return Promise.resolve([]);
        }
        if (cmd === 'plugin:sql|execute') return Promise.resolve([1, 0]);
        if (cmd === 'remote_camera_active') return Promise.resolve(null);
        if (cmd === 'get_phone_link_remember') return Promise.resolve(false);
        if (cmd?.startsWith('plugin:event|')) return Promise.resolve(Math.floor(Math.random() * 1e6));
        if (cmd?.startsWith('plugin:path|')) return Promise.resolve('/tmp');
        if (cmd?.startsWith('plugin:fs|')) return Promise.resolve(cmd.includes('exists') ? true : null);
        if (cmd?.startsWith('plugin:dialog|')) return Promise.resolve(null);
        return Promise.resolve(null);
      },
    };
  }, { patientRow: PATIENT_ROW, scale: uiScale });

  await page.goto('/patients/view?id=p1');
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.getByRole('button', { name: 'Pick date of birth' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Pick date of birth' }).click();
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(400);
}

/** The popover must sit fully inside the dialog card and the viewport. */
async function expectContained(page: Page): Promise<void> {
  const c = await page.evaluate(() => {
    const pop = document.querySelector('[data-slot="popover-content"]')?.getBoundingClientRect();
    const dlg = document.querySelector('[data-slot="dialog-content"]')?.getBoundingClientRect();
    if (!pop) return null;
    return {
      pop: { top: pop.top, left: pop.left, bottom: pop.bottom, right: pop.right },
      dlg: dlg
        ? { top: dlg.top, left: dlg.left, bottom: dlg.bottom, right: dlg.right }
        : null,
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  expect(c, 'calendar popover is open').toBeTruthy();
  const { pop, dlg, vw, vh } = c!;
  expect(pop.top, 'calendar top inside the viewport').toBeGreaterThanOrEqual(0);
  expect(pop.left, 'calendar left inside the viewport').toBeGreaterThanOrEqual(0);
  expect(pop.bottom, 'calendar bottom inside the viewport').toBeLessThanOrEqual(vh);
  expect(pop.right, 'calendar right inside the viewport').toBeLessThanOrEqual(vw);
  if (dlg) {
    expect(pop.top, 'calendar top inside the dialog').toBeGreaterThanOrEqual(dlg.top);
    expect(pop.left, 'calendar left inside the dialog').toBeGreaterThanOrEqual(dlg.left);
    expect(pop.bottom, 'calendar bottom inside the dialog').toBeLessThanOrEqual(dlg.bottom);
    expect(pop.right, 'calendar right inside the dialog').toBeLessThanOrEqual(dlg.right);
  }
}

const SIZES: Array<[string, number, number, number]> = [
  ['short window — the reported shape', 900, 520, 100],
  ['narrow window', 420, 760, 100],
  ['mid size', 620, 900, 100],
  ['narrow at the 130% scale ceiling', 420, 760, 130],
  ['wide at the 130% scale ceiling', 1280, 800, 130],
];

for (const [name, w, h, scale] of SIZES) {
  test.describe(`dob calendar stays inside its container: ${name}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('popover contained in dialog and viewport', async ({ page }) => {
      await openEditDialogCalendar(page, scale);
      await expectContained(page);
    });
  });
}
