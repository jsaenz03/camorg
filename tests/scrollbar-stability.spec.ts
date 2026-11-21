/**
 * Scrollbar-stability pins (browser-only smoke test, from the 21/11 UI audit
 * of "dropdowns shift the dropdown box and the elements on the canvas").
 *
 * Three measured facts must hold:
 *
 * 1. html reserves the scrollbar gutter (scrollbar-gutter: stable). A filter
 *    that shrinks the gallery otherwise appears/disappears the Windows
 *    classic scrollbar and shifts the whole canvas sideways on selection.
 *    Overlay-scrollbar platforms take no space, so this is invisible there.
 *
 * 2. Radix Select's scroll-lock stays inert on camog. html owns the viewport
 *    overflow (overflow-x: clip), so body[data-scroll-locked] overflow:hidden
 *    must not remove the viewport scrollbar or seal page scroll — measured
 *    here so a Radix/react-remove-scroll upgrade that starts removing it is
 *    caught: its gap compensation is measured once per session (style
 *    singleton) and would shift uncompensated afterwards.
 *
 * 3. Select panels left-align with their trigger (align="start"), instead of
 *    centering and overhanging both sides when the panel is wider than the
 *    trigger — the timeline bar's fixed w-[180px] selects visibly shifted on
 *    every pull.
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

test('html reserves the gutter, the scroll-lock stays inert, panels left-align', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/settings');
  const trigger = page.locator('[data-slot="select-trigger"]').first();
  await trigger.waitFor({ state: 'visible', timeout: 20000 });

  // Pin 1 — the gutter is reserved on the viewport scroller.
  const gutter = await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter);
  expect(gutter).toBe('stable');

  // Pin 2 — the lock runs but must not seal the page scroll or shift width.
  const before = await page.evaluate(() => ({
    clientW: document.documentElement.clientWidth,
    triggerTop: document.querySelector('[data-slot="select-trigger"]')!.getBoundingClientRect().top,
  }));
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await trigger.click();
  const panel = page.locator('[data-slot="select-content"]').first();
  await expect(panel).toBeVisible({ timeout: 5000 });

  await expect(page.locator('body[data-scroll-locked]')).toHaveCount(1);
  const lockState = await page.evaluate(() => {
    window.scrollTo(0, 400);
    return {
      scrollY: window.scrollY,
      clientW: document.documentElement.clientWidth,
    };
  });
  expect(lockState.scrollY).toBeGreaterThan(0); // page still scrolls behind the open select
  expect(lockState.clientW).toBe(before.clientW); // and no scrollbar was removed

  // Pin 3 — the open panel's left edge sits on the trigger's left edge.
  const rects = await page.evaluate(() => {
    const t = document.querySelector('[data-slot="select-trigger"]')!.getBoundingClientRect();
    const p = document.querySelector('[data-slot="select-content"]')!.getBoundingClientRect();
    return { triggerLeft: t.left, panelLeft: p.left };
  });
  expect(Math.abs(rects.panelLeft - rects.triggerLeft)).toBeLessThan(2);

  // The lock releases cleanly on close.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden({ timeout: 5000 });
  await expect(page.locator('body[data-scroll-locked]')).toHaveCount(0);
});
