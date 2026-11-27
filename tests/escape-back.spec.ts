/**
 * Escape steps back up the screen hierarchy (components/escape-back.tsx).
 *
 * Radix already closes dialogs on Escape; this pins the page layer on top:
 * report → patient → patient list → dashboard, matching the pages' own back
 * buttons, with the guards that make Escape predictable — while a dialog is
 * open Escape only closes it (URL unchanged) and the NEXT Escape steps back;
 * focus inside a text field opts out; the dashboard and Settings are
 * top-level so Escape does nothing there.
 */
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __TAURI_INTERNALS__: Record<string, unknown>;
  }
}

test.use({ viewport: { width: 1200, height: 700 } });

/** Fake Tauri IPC (canned SQL rows) + session so dashboard routes render. */
async function fakeIpc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
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
          if (q.includes('from patients p')) return Promise.resolve([]);
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
  });
}

/** The semantic path (next.config's trailingSlash: true adds one to every
 *  section route in the address bar) — compared without it. */
const path = (page: Page) =>
  page.evaluate(() => `${window.location.pathname.replace(/\/+$/, '') || '/'}${window.location.search}`);

/** Wait for a semantic path: dev-mode compiles routes on first navigation,
 *  so a fixed sleep after Escape races the transition. */
async function arrive(page: Page, expected: string): Promise<void> {
  await page.waitForURL(
    (url) => `${url.pathname.replace(/\/+$/, '') || '/'}${url.search}` === expected,
    { timeout: 20000 },
  );
  expect(await path(page)).toBe(expected);
}

test('Escape walks report → patient → patient list → dashboard, then stops', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients/report?id=p1');
  await page.waitForTimeout(600); // let the route settle
  await page.keyboard.press('Escape');
  await arrive(page, '/patients/view?id=p1');

  await page.keyboard.press('Escape');
  await arrive(page, '/patients');

  await page.keyboard.press('Escape');
  await arrive(page, '/');

  await page.keyboard.press('Escape'); // dashboard is top-level
  await page.waitForTimeout(600);
  expect(await path(page)).toBe('/');
});

test('Escape closes an open dialog first, then steps back on the next press', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  const add = page.getByRole('button', { name: /add patient/i });
  await add.waitFor({ state: 'visible', timeout: 20000 });
  await add.click();
  const dialog = page.locator('[data-slot="dialog-content"]').first();
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);

  await page.keyboard.press('Escape'); // Radix closes the dialog…
  await expect(dialog).toBeHidden({ timeout: 5000 });
  expect(await path(page)).toBe('/patients'); // …and nothing else happens

  await page.keyboard.press('Escape'); // now the screen is clean
  await arrive(page, '/');
});

test('Escape in a text field does not navigate', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  await page.getByRole('button', { name: /add patient/i }).waitFor({ state: 'visible', timeout: 20000 });
  const search = page.getByPlaceholder(/Search by name or date of birth/);
  await search.click();
  await page.keyboard.type('sm');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  expect(await path(page)).toBe('/patients'); // stayed put
});
