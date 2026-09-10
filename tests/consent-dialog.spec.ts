/**
 * Consent flow (browser-only smoke test).
 *
 * Drives the patient timeline's consent banner → RecordConsentDialog → save
 * against a fake Tauri IPC (canned SQL rows), pinning the fix for the
 * "stuck on Saving…" regression: the dialog must CLOSE after a successful
 * save, release the body pointer-events lock, and clear the banner.
 *
 * That regression came from giving the dialog a remount `key` that collided
 * with its sibling EditPatientDialog's identical `${id}:${updatedAt}` key —
 * duplicate sibling keys corrupted reconciliation and orphaned the open
 * Radix dialog. This spec fails if the dialog ever stays in the DOM.
 *
 * The second test pins keyboard confirmation: the dialog is a real form with
 * the confirm button autofocused, so Enter accepts (no mouse needed).
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

/** Fake Tauri IPC (canned SQL rows) + session, then open the consent dialog. */
async function openConsentDialog(page: Page): Promise<void> {
  await page.addInitScript(({ patientRow }) => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    const state: { patient: Record<string, unknown>; audit: unknown[] } = { patient: patientRow, audit: [] };
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
          if (q.includes('from patients p')) return Promise.resolve([state.patient]);
          if (q.includes('from photos')) return Promise.resolve([]);
          if (q.includes('from audit_log')) return Promise.resolve(state.audit.slice(-5).reverse());
          return Promise.resolve([]);
        }
        if (cmd === 'plugin:sql|execute') {
          const query = args?.query || '';
          if (query.toLowerCase().includes('insert into audit_log')) {
            state.audit.push({ id: crypto.randomUUID(), action: 'patient.consent', created_at: Date.now(), detail: 'x' });
          }
          if (query.includes('consent_given_at')) {
            state.patient = {
              ...state.patient,
              consent_given_at: (args?.values?.[0] as number) ?? Date.now(),
              consent_scope: (args?.values?.[1] as string) ?? 'care',
              updated_at: Date.now(),
            };
          }
          return Promise.resolve([1, 0]);
        }
        if (cmd === 'remote_camera_active') return Promise.resolve(null);
        if (cmd === 'start_remote_camera' || cmd === 'reset_pairing_token') {
          return Promise.resolve({ urls: [{ url: 'http://localhost:54561' }] });
        }
        if (cmd === 'get_phone_link_remember') return Promise.resolve(false);
        if (cmd === 'remote_camera_idle_ms') return Promise.resolve(0);
        if (cmd?.startsWith('plugin:event|')) return Promise.resolve(Math.floor(Math.random() * 1e6));
        if (cmd?.startsWith('plugin:path|')) return Promise.resolve('/tmp');
        if (cmd?.startsWith('plugin:fs|')) return Promise.resolve(cmd.includes('exists') ? true : null);
        if (cmd?.startsWith('plugin:dialog|')) return Promise.resolve(null);
        return Promise.resolve(null);
      },
    };
  }, { patientRow: PATIENT_ROW });

  await page.goto('/patients/view?id=p1');

  const bannerButton = page.getByRole('button', { name: 'Record consent', exact: true });
  await expect(bannerButton).toBeVisible({ timeout: 15000 });

  await bannerButton.click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Record photo consent');
}

test('recording consent from the timeline banner closes the dialog and clears the banner', async ({ page }) => {
  await openConsentDialog(page);

  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('button', { name: /Record consent/ }).click();

  // The fix this spec pins: the dialog must fully leave the DOM, the body
  // scroll-lock must release, and the banner must not reappear.
  await expect(dialog).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
  await expect(page.getByText('No photo consent on record')).toHaveCount(0);
});

test('pressing Enter accepts the consent dialog', async ({ page }) => {
  await openConsentDialog(page);

  // The confirm button is autofocused, so Enter straight after opening —
  // the keyboard path a clinician takes — records the consent.
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.locator('button[type="submit"]')).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
  await expect(page.getByText('No photo consent on record')).toHaveCount(0);
});
