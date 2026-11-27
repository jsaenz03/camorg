/**
 * Scrollbar-stability pins (browser-only smoke test).
 *
 * History: the 21/11 audit pinned `scrollbar-gutter: stable` against Windows
 * classic-scrollbar churn. The 28/11 audit (user: "clicking a button to bring
 * up a modal shifts the screen behind it left, then it shifts back right when
 * the modal is closed") root-caused that shift and superseded the gutter
 * regime. react-remove-scroll — which scroll-locks every Radix Dialog and
 * Select — measures gap = window.innerWidth − documentElement.clientWidth and
 * injects body[data-scroll-locked] { margin-right: <gap>px !important } even
 * though html's overflow-x: clip guarantees the lock never removes the
 * viewport scrollbar: it compensates for a scrollbar that is still there.
 * A Windows classic scrollbar (and scrollbar-gutter: stable, which reserved
 * the gutter even with nothing to scroll) made the gap ≈ 17px at all times,
 * so opening a modal pulled the whole canvas left and closing let it spring
 * back. Measured pre-fix with a clientWidth −17px override driving the real
 * library end-to-end: body/SidebarInset width Δ −17px while locked.
 *
 * The fix: scrollbars are abolished app-wide (globals.css) — scrollbar-width:
 * none with a ::-webkit-scrollbar fallback — while wheel/trackpad/keyboard
 * scrolling and Radix ScrollArea's own DOM thumbs are untouched. No scrollbar
 * ever consumes layout width, clientWidth == innerWidth by construction, and
 * the measured gap — and with it the compensation margin — is always 0.
 *
 * Four measured facts must hold:
 *
 * 1. No layout scrollbar exists: html computes scrollbar-width: none, and
 *    with real vertical overflow documentElement.clientWidth === innerWidth.
 *    On a classic-scrollbar Windows box pre-fix this measured 1183 vs 1200 —
 *    it fails the moment any scrollbar consumes layout width again.
 *
 * 2. Radix Select's scroll-lock stays inert on camog (unchanged from the
 *    21/11 audit): html owns the viewport overflow (overflow-x: clip), so
 *    body[data-scroll-locked] overflow:hidden must not seal page scroll —
 *    and it cannot shift width either: the gap is 0, so the compensation
 *    margin stays 0px.
 *
 * 3. Select panels left-align with their trigger (align="start"), instead of
 *    centering and overhanging both sides when the panel is wider than the
 *    trigger — the timeline bar's fixed w-[180px] selects visibly shifted on
 *    every pull.
 *
 * 4. Opening a real Dialog (Add patient) must not move the canvas: while
 *    body[data-scroll-locked], body's computed margin-right is 0px and its
 *    rect width is unchanged, and both hold after the lock releases.
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

/** 3000px absolute spacer so the document really overflows: on a classic-
 *  scrollbar platform a scrollbar would then consume layout width. */
async function forceOverflow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:3000px;pointer-events:none;';
    document.body.appendChild(d);
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(overflow).toBeGreaterThan(700); // the canary below is meaningless without real overflow
}

test('no layout scrollbar, the scroll-lock stays inert, panels left-align', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/settings');
  await forceOverflow(page);
  const trigger = page.locator('[data-slot="select-trigger"]').first();
  await trigger.waitFor({ state: 'visible', timeout: 20000 });

  // Pin 1 — no scrollbar consumes layout width anywhere.
  const scrollbar = await page.evaluate(() => ({
    width: getComputedStyle(document.documentElement).scrollbarWidth,
    clientW: document.documentElement.clientWidth,
    innerW: window.innerWidth,
  }));
  expect(scrollbar.width).toBe('none');
  expect(scrollbar.clientW).toBe(scrollbar.innerW);

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
      bodyMarginRight: getComputedStyle(document.body).marginRight,
    };
  });
  expect(lockState.scrollY).toBeGreaterThan(0); // page still scrolls behind the open select
  expect(lockState.clientW).toBe(before.clientW); // and no scrollbar was removed
  expect(lockState.bodyMarginRight).toBe('0px'); // so the gap compensation is 0

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

test('opening a dialog never moves the canvas', async ({ page }) => {
  await fakeIpc(page);
  await page.goto('/patients');
  await forceOverflow(page);

  const addPatient = page.getByRole('button', { name: /add patient/i });
  await addPatient.waitFor({ state: 'visible', timeout: 20000 });
  const before = await page.evaluate(() => ({
    clientW: document.documentElement.clientWidth,
    innerW: window.innerWidth,
    bodyMarginRight: getComputedStyle(document.body).marginRight,
    bodyW: document.body.getBoundingClientRect().width,
  }));
  expect(before.clientW).toBe(before.innerW);

  await addPatient.click();
  const dialog = page.locator('[data-slot="dialog-content"]').first();
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400); // Radix zoom/fade settles

  await expect(page.locator('body[data-scroll-locked]')).toHaveCount(1);
  const locked = await page.evaluate(() => ({
    bodyMarginRight: getComputedStyle(document.body).marginRight,
    bodyW: document.body.getBoundingClientRect().width,
  }));
  expect(locked.bodyMarginRight).toBe('0px'); // no compensation margin injected
  expect(locked.bodyW).toBeCloseTo(before.bodyW, 1); // canvas did not pull in

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5000 });
  await expect(page.locator('body[data-scroll-locked]')).toHaveCount(0);
  const released = await page.evaluate(() => ({
    bodyMarginRight: getComputedStyle(document.body).marginRight,
    bodyW: document.body.getBoundingClientRect().width,
  }));
  expect(released.bodyMarginRight).toBe('0px');
  expect(released.bodyW).toBeCloseTo(before.bodyW, 1);
});
