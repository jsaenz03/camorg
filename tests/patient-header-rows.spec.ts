/**
 * Patient header two-row structure (browser-only smoke test).
 *
 * The patient view's PageHeader used to receive the status badges and the
 * action buttons in one shared row: PageHeader's actions container was
 * shrink-0, so the full row's width forced itself onto the layout and the
 * title/metadata column squished on small screens, with badges and buttons
 * interleaved as the row wrapped. Status now renders as its own row inside
 * the metadata block and the action row wraps right-aligned instead of
 * squeezing anything. Pinned here: the grouping (badges never share a
 * container with the buttons) and viewport containment at tight widths.
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

test.describe('patient header rows', () => {
  for (const [name, w, h] of [['narrow', 420, 700], ['tight desktop', 720, 800]] as const) {
    test.use({ viewport: { width: w, height: h } });

    test(`status row and action row stay apart: ${name}`, async ({ page }) => {
      await openPatientView(page);

      const layout = await page.evaluate(() => {
        const privacy = [...document.querySelectorAll('[data-slot="badge"]')].find(
          (b) => b.textContent?.includes('Private'),
        );
        const capture = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.includes('Capture'),
        );
        if (!privacy || !capture) return null;
        // The badge lives in the metadata block (which also holds the page
        // title); the button lives in the trailing action row, which holds
        // no title. Nothing pokes past the viewport's right edge.
        const metaHasTitle = privacy.parentElement?.parentElement?.querySelector('h1') !== null;
        const actionsHaveTitle = capture.parentElement?.querySelector('h1') !== null;
        const widest = Math.max(privacy.getBoundingClientRect().right, capture.getBoundingClientRect().right);
        return { metaHasTitle, actionsHaveTitle, widest, innerWidth };
      });

      expect(layout, 'privacy badge and Capture button are both rendered').toBeTruthy();
      expect(layout!.metaHasTitle, 'status badges sit in the metadata block under the title').toBe(true);
      expect(layout!.actionsHaveTitle, 'action row carries buttons, not the title').toBe(false);
      expect(layout!.widest).toBeLessThanOrEqual(layout!.innerWidth);
    });
  }
});
