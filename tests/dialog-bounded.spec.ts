/**
 * Bounded-dialog check (browser-only smoke test).
 *
 * The tall form dialogs used to render as an unbounded grid: on a short
 * window the lower fields and the action bar (Save / Delete) fell below the
 * viewport edge with no scrollbar and no way to reach them. Every tall
 * dialog is now a bounded flex column — header and footer pinned, the
 * middle scrolls — measured here at a deliberately short viewport against
 * the real page and its fake Tauri IPC.
 *
 * Pins the Edit patient details fix (the reported case) and the record
 * consent dialog that shares the page. The remaining dialogs reuse the same
 * class mechanism; structure is pinned by scripts/self-check-dialog-bounded.mjs.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

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

test.use({ viewport: { width: 500, height: 550 } });

/** Fake Tauri IPC (canned SQL rows) + session, then land on the patient view. */
async function openPatientView(page: Page): Promise<void> {
  await page.addInitScript(({ patientRow }) => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    const state: { patient: Record<string, unknown> } = { patient: patientRow };
    const settings = { id: 'app', photos_dir: null, review_warning_days: 7, review_stale_days: 90, allow_public_signup: 1, logo: null, org_name: 'Clinic', session_timeout_ms: 1800000, idle_lock_timeout_ms: 300000 };
    const clinician = { id: 'c1', username: 'drx', display_name: 'Dr X', role: 'admin', is_active: 1, is_pending: 0, must_change_passcode: 0, preferences: '{}', created_at: Date.now(), last_login_at: Date.now() };
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
  }, { patientRow: PATIENT_ROW });

  await page.goto('/patients/view?id=p1');
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible({ timeout: 15000 });
}

/**
 * The bounded-dialog assertions, measured on an open dialog: the action bar
 * must sit fully inside the viewport and the middle region must be clamped
 * (not sized by its content). Whether the content overflows the clamp
 * depends on the viewport, so only the Edit dialog — whose form is always
 * taller than a short window — additionally asserts real scrolling.
 */
async function expectBounded(page: Page, actionLabel: RegExp): Promise<Locator> {
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  // Radix finishes its open animation; measure after it settles.
  await page.waitForTimeout(400);

  const action = dialog.getByRole('button', { name: actionLabel }).first();
  await expect(action).toBeVisible();
  const actionBox = await action.boundingBox();
  expect(actionBox, 'action bar must be reachable inside the window').not.toBeNull();
  expect(actionBox!.y + actionBox!.height, 'action bar must not fall below the viewport')
    .toBeLessThanOrEqual(550);

  // The scroll region: a bounded dialog's middle is clamped inside the
  // dialog instead of growing with its content.
  const region = dialog.locator('div[class*="-mx-6"][class*="overflow-y-auto"]');
  const clientHeight = await region.evaluate((el) => el.clientHeight);
  expect(clientHeight, 'scroll region is clamped inside the dialog').toBeLessThan(550);
  return region;
}

test('Edit patient details scrolls and keeps Save reachable on a short window', async ({ page }) => {
  await openPatientView(page);
  await page.getByRole('button', { name: 'Edit details' }).click();
  const region = await expectBounded(page, /Save changes/);

  // The edit form is taller than any short window: the clamp must actually
  // scroll, and scrolling brings the bottom fields into view.
  const boxes = await region.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(
    boxes.scrollHeight,
    'form content overflows the clamp — it scrolls',
  ).toBeGreaterThan(boxes.clientHeight);
  await region.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator('[role="dialog"]').getByText('Next review date (optional)')).toBeVisible();
});

test('Record consent keeps its action reachable on a short window', async ({ page }) => {
  await openPatientView(page);
  await page.getByRole('button', { name: 'Record consent', exact: true }).click();
  await expectBounded(page, /Record consent/);
});
