/**
 * Interface scale check (browser-only smoke test).
 *
 * Settings → Profile → Interface scale zooms the whole UI by driving the
 * root font-size (everything in the app is rem-based). Pins four things:
 * a saved scale applies across the whole dashboard, the slider commits
 * through the real preference round-trip, a bounded dialog still keeps
 * its action bar reachable at the 130% ceiling on the low-resolution laptop
 * viewport that motivated the setting, and no main route overflows
 * horizontally at that ceiling (scrollWidth still reports clipped overflow
 * even though html's overflow-x: clip hides the scrollbar).
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

// The complaint scenario: a small laptop screen where the default UI reads
// as zoomed in.
test.use({ viewport: { width: 1366, height: 768 } });

/** Fake Tauri IPC with a mutable clinician preferences row. */
async function openPatientView(page: Page, initialPrefs: string): Promise<void> {
  await page.addInitScript(({ patientRow, prefs }) => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    const state = { preferencesJson: prefs };
    const settings = { id: 'app', photos_dir: null, review_warning_days: 7, review_stale_days: 90, allow_public_signup: 1, logo: null, org_name: 'Clinic', session_timeout_ms: 1800000, idle_lock_timeout_ms: 300000 };
    const clinician = { id: 'c1', username: 'drx', display_name: 'Dr X', role: 'admin', is_active: 1, is_pending: 0, must_change_passcode: 0, preferences: prefs, created_at: Date.now(), last_login_at: Date.now() };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      plugins: {},
      transformCallback: () => Math.floor(Math.random() * 1e6),
      invoke: (cmd: string, args?: { query?: string; values?: unknown[] }): Promise<unknown> => {
        const q = (args?.query || '').toLowerCase();
        if (cmd === 'plugin:sql|select') {
          if (q.includes('count(')) return Promise.resolve([{ n: 1 }]);
          if (q.includes('from settings')) return Promise.resolve([settings]);
          if (q.includes('from clinicians')) {
            return Promise.resolve([{ ...clinician, preferences: state.preferencesJson }]);
          }
          if (q.includes('from patients p')) return Promise.resolve(patientRow);
          if (q.includes('from photos')) return Promise.resolve([]);
          if (q.includes('from audit_log')) return Promise.resolve([]);
          return Promise.resolve([]);
        }
        // updatePreferences binds the preferences JSON as its first value —
        // remember it so the next refresh reads the new scale back.
        if (cmd === 'plugin:sql|execute' && q.includes('update clinicians') && args?.values?.length) {
          state.preferencesJson = String(args.values[0]);
          return Promise.resolve([1, 0]);
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
  }, { patientRow: PATIENT_ROW, prefs: initialPrefs });

  await page.goto('/patients/view?id=p1');
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible({ timeout: 15000 });
}

function htmlFontSize(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
}

test('a saved scale applies across the whole dashboard', async ({ page }) => {
  await openPatientView(page, '{"uiScale":80}');
  // 80% × the 16px browser default — and the page above is already usable.
  expect(await htmlFontSize(page)).toBe('12.8px');
});

test('the slider commits on release and the scale applies live', async ({ page }) => {
  await openPatientView(page, '{}');
  expect(await htmlFontSize(page)).toBe('16px');

  await page.goto('/settings?tab=profile');
  const slider = page.getByLabel('Interface scale');
  await expect(slider).toBeVisible({ timeout: 15000 });

  // Keyboard path (the accessible one): one arrow step, committed on keyup
  // — one preference save, then the dashboard layout re-zooms the app.
  await slider.focus();
  await slider.press('ArrowRight');
  await expect.poll(() => htmlFontSize(page), { timeout: 10000 }).toBe('16.8px');
  await expect(slider).toHaveValue('105');
});

test('a tall dialog keeps its action reachable at the 130% ceiling', async ({ page }) => {
  await openPatientView(page, '{"uiScale":130}');
  expect(await htmlFontSize(page)).toBe('20.8px');

  // Nothing escapes the laptop window sideways at the ceiling either.
  const mainBox = await page.locator('[data-slot="sidebar-inset"]').boundingBox();
  expect(mainBox, 'main content must be measurable').not.toBeNull();
  expect(mainBox!.x, 'main content starts inside the window').toBeGreaterThanOrEqual(0);
  expect(mainBox!.x + mainBox!.width, 'main content ends inside the window').toBeLessThanOrEqual(1366);

  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  // Radix finishes its open animation; measure after it settles.
  await page.waitForTimeout(400);

  const action = dialog.getByRole('button', { name: /Save changes/ }).first();
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box, 'Save must be reachable at 130%').not.toBeNull();
  expect(box!.y + box!.height, 'Save must not fall below the viewport').toBeLessThanOrEqual(768);
});

test('no main route overflows horizontally at the 130% ceiling', async ({ page }) => {
  await openPatientView(page, '{"uiScale":130}');

  for (const url of ['/patients/view?id=p1', '/patients', '/', '/photos', '/compare', '/settings?tab=profile']) {
    await page.goto(url);
    await page.waitForTimeout(1500); // let data/charts settle before measuring
    const { doc, vw } = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      vw: document.documentElement.clientWidth,
    }));
    expect(doc, `${url} must not overflow horizontally at 130%`).toBeLessThanOrEqual(vw);
  }
});
