/**
 * Selection & link-dialog polish checks (browser-only smoke test).
 *
 * Pins two Windows test-pass findings, both driven with real CDP input so
 * Chromium's focus heuristics participate (synthetic dispatched events skip
 * them, which is why the first one was never reproducible at component
 * level):
 *  - Escape after a ⌘/Ctrl multi-select cleared the selection state but left
 *    the last-clicked tile focused, and Chromium paints its :focus-visible
 *    ring from the Escape keydown itself — --ring is --primary, so the tile
 *    read as "one still selected". The galleries now blur a focused tile
 *    when Escape clears.
 *  - The link dialog's series input sits flush with its scroll region's
 *    clip edge whenever a fresh multi-link has no hint rows (the region has
 *    no vertical padding), clipping the bottom of the input's 3px focus
 *    ring right where the button pane begins. The region now carries py-3.
 *
 * ⌘ (Meta) stands in for Ctrl here: macOS-Chromium turns ctrl+click into a
 * context menu, while the Windows gesture is a plain left click with the
 * modifier — the same event shape Meta+click produces.
 */
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __TAURI_INTERNALS__: Record<string, unknown>;
  }
}

const PATIENT_ROW = {
  id: 'p1', name: 'Joe Sample', normalized_name: 'joe sample', dob: null,
  photo_count: 5, deleted_photo_count: 0,
  created_at: Date.now() - 86400000, updated_at: Date.now() - 3600000,
  last_photo_at: Date.now() - 3600000, clinician_id: 'c1',
  is_archived: 0, archived_at: null, owner_clinician_id: 'c1', is_org_shared: 0,
  consent_given_at: null, consent_scope: null, consent_expires_at: null,
  review_due_at: null, last_reviewed_at: null, owner_name: 'Dr X',
};

const now = Date.now();
const PHOTO_ROWS = [1, 2, 3, 4, 5].map((i) => ({
  id: `ph${i}`, patient_id: 'p1', original_file_name: `p${i}.jpg`,
  mime_type: 'image/jpeg', file_size_bytes: 1000,
  body_part: 'hand', laterality: 'left', subpart: null,
  clinical_notes: null, pin_x: null, pin_y: null, pin_space: null, pin_view: null,
  review_due_at: null, last_reviewed_at: null, lesion_group: null,
  captured_at: now - i * 60000, created_at: now - i * 60000, updated_at: now - i * 60000,
  clinician_id: 'c1', is_deleted: 0, deleted_at: null,
  image_path: '/tmp/x', thumbnail_path: '/tmp/t',
}));

const SETTINGS = { id: 'app', photos_dir: null, review_warning_days: 7, review_stale_days: 90, allow_public_signup: 1, logo: null, org_name: 'Clinic', session_timeout_ms: 1800000, idle_lock_timeout_ms: 300000 };
const CLINICIAN = { id: 'c1', username: 'drx', display_name: 'Dr X', role: 'admin', is_active: 1, is_pending: 0, must_change_passcode: 0, preferences: '{}', created_at: now, last_login_at: now };

/** Fake Tauri IPC (canned SQL rows) + session, then land on the Photos page. */
async function openPhotosPage(page: Page): Promise<void> {
  await page.addInitScript(({ patientRow, photos, settings, clinician }) => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      plugins: {},
      transformCallback: () => Math.floor(Math.random() * 1e6),
      invoke: (cmd: string, args?: { query?: string; values?: unknown[] }): Promise<unknown> => {
        const q = (args?.query || '').toLowerCase();
        if (cmd === 'plugin:sql|select') {
          if (q.includes('count(*)')) return Promise.resolve([{ total: photos.length }]);
          if (q.includes('from photos ph join patients p')) return Promise.resolve(photos);
          if (q.includes('distinct lesion_group')) return Promise.resolve([]);
          if (q.includes('from photos')) return Promise.resolve(photos);
          if (q.includes('from patients')) return Promise.resolve([patientRow]);
          if (q.includes('from settings')) return Promise.resolve([settings]);
          if (q.includes('from clinicians')) return Promise.resolve([clinician]);
          if (q.includes('audit_log')) return Promise.resolve([]);
          return Promise.resolve([]);
        }
        if (cmd === 'plugin:sql|execute') return Promise.resolve([1, 0]);
        if (cmd?.startsWith('plugin:event|')) return Promise.resolve(Math.floor(Math.random() * 1e6));
        if (cmd?.startsWith('plugin:path|')) return Promise.resolve('/tmp');
        if (cmd?.startsWith('plugin:fs|')) return Promise.resolve(cmd.includes('exists') ? true : null);
        if (cmd?.startsWith('plugin:dialog|')) return Promise.resolve(null);
        return Promise.resolve(null);
      },
    };
  }, { patientRow: PATIENT_ROW, photos: PHOTO_ROWS, settings: SETTINGS, clinician: CLINICIAN });

  await page.goto('/photos');
  await expect(page.locator('[data-photo-id]')).toHaveCount(5, { timeout: 20000 });
}

test('Escape clears a ⌘/Ctrl multi-select completely — no tile left ringed', async ({ page }) => {
  await openPhotosPage(page);
  const tiles = page.locator('[data-photo-id]');

  await tiles.nth(1).click({ modifiers: ['Meta'] });
  await tiles.nth(3).click({ modifiers: ['Meta'] });
  expect(
    await tiles.evaluateAll((els) => els.filter((el) => el.className.includes('ring-2 ring-primary')).length),
    'two tiles carry the selection ring',
  ).toBe(2);

  await page.keyboard.press('Escape');

  expect(
    await tiles.evaluateAll((els) => els.filter((el) => el.className.includes('ring-2 ring-primary')).length),
    'the selection ring is gone from every tile',
  ).toBe(0);
  expect(
    await tiles.evaluateAll((els) => els.filter((el) => el.matches(':focus-visible')).length),
    'no tile keeps a focus ring that reads as "one still selected"',
  ).toBe(0);
  expect(
    await page.evaluate(() => document.activeElement === document.body),
    'focus released from the tiles',
  ).toBe(true);
});

test('Link dialog keeps the series input ring clear of the scroll clip', async ({ page }) => {
  await openPhotosPage(page);
  const tiles = page.locator('[data-photo-id]');

  // A carried selection links without hint rows, so the autofocused input
  // ends the scroll region — the reported clipping case.
  await tiles.nth(1).click({ modifiers: ['Meta'] });
  await tiles.nth(2).click({ modifiers: ['Meta'] });
  const from = await tiles.nth(1).boundingBox();
  const onto = await tiles.nth(4).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto!.x + onto!.width / 2, onto!.y + onto!.height / 2, { steps: 12 });
  await page.mouse.up();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  // Radix finishes its open animation before the geometry settles.
  await page.waitForTimeout(400);

  const input = dialog.locator('#photo-link-series');
  await expect(input).toBeFocused();
  const clearance = await page.evaluate(() => {
    const input = document.querySelector('#photo-link-series') as HTMLElement;
    const region = (document.querySelector('[role="dialog"]') as HTMLElement).querySelector(
      'div[class*="-mx-6"]',
    ) as HTMLElement;
    const ir = input.getBoundingClientRect();
    const rr = region.getBoundingClientRect();
    return { top: ir.top - rr.top, bottom: rr.top + region.clientHeight - ir.bottom };
  });
  // The ring is a 3px box-shadow; either edge flush with the clip cuts it.
  expect(clearance.bottom, 'ring survives the region bottom (above the button pane)').toBeGreaterThanOrEqual(3);
  expect(clearance.top, 'ring survives the region top').toBeGreaterThanOrEqual(3);
});
