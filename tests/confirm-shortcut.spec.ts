/**
 * Ctrl/Cmd+Enter commits the topmost open dialog (components/confirm-shortcut.tsx).
 *
 * The dashboard mounts one capture-phase keydown listener that finds the
 * topmost open Radix dialog and drives its real commit path — the body's
 * <form> via requestSubmit() (react-hook-form's validation still gates the
 * submit), else a button marked data-confirm-shortcut. Measured here against
 * the real Add patient dialog: an empty required name must not commit, a
 * valid one must run the patient INSERT — via Ctrl+Enter (Windows) and
 * Cmd+Enter (macOS) — and Ctrl+Enter with no dialog open must do nothing.
 */
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __TAURI_INTERNALS__: Record<string, unknown>;
    __invokes: string[];
  }
}

test.use({ viewport: { width: 1200, height: 700 } });

/** Fake Tauri IPC (canned SQL rows) + session, with an invoke tape. */
async function fakeIpc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    const settings = { id: 'app', photos_dir: null, review_warning_days: 7, review_stale_days: 90, allow_public_signup: 1, logo: null, org_name: 'Clinic', session_timeout_ms: 1800000, idle_lock_timeout_ms: 300000 };
    const clinician = { id: 'c1', username: 'drx', display_name: 'Dr X', role: 'admin', is_active: 1, is_pending: 0, must_change_passcode: 0, preferences: '{}', created_at: Date.now(), last_login_at: Date.now() };
    window.__invokes = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      plugins: {},
      transformCallback: () => Math.floor(Math.random() * 1e6),
      invoke: (cmd: string, args?: { query?: string; values?: unknown[] }): Promise<unknown> => {
        window.__invokes.push(`${cmd} ${args?.query ?? ''}`.toLowerCase());
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

async function patientInserts(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__invokes.filter((s) => s.includes('insert into patients')));
}

async function openAddPatient(page: Page): Promise<void> {
  const add = page.getByRole('button', { name: /add patient/i });
  await add.waitFor({ state: 'visible', timeout: 20000 });
  await add.click();
  await expect(page.locator('[data-slot="dialog-content"]').first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400); // Radix zoom/fade settles
}

test('Ctrl+Enter with no dialog open does nothing', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  await page.getByRole('button', { name: /add patient/i }).waitFor({ state: 'visible', timeout: 20000 });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  expect(await patientInserts(page)).toEqual([]);
});

test('Ctrl+Enter on an invalid form leaves the dialog open and commits nothing', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  await openAddPatient(page);
  await page.keyboard.press('Control+Enter'); // name still empty
  await page.waitForTimeout(300);
  expect(await patientInserts(page)).toEqual([]);
  await expect(page.locator('[data-slot="dialog-content"]').first()).toBeVisible();
});

test('Ctrl+Enter commits a valid dialog form', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  await openAddPatient(page);
  await page.keyboard.type('Shortcut Repro'); // name field has autofocus
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(500);
  const inserts = await patientInserts(page);
  expect(inserts.length).toBeGreaterThan(0);
  expect(inserts[0]).toContain('insert into patients');
});

test('Cmd+Enter commits a valid dialog form too (macOS)', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  await openAddPatient(page);
  await page.keyboard.type('Shortcut Repro Two');
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(500);
  const inserts = await patientInserts(page);
  expect(inserts.length).toBeGreaterThan(0);
  expect(inserts[0]).toContain('insert into patients');
});
