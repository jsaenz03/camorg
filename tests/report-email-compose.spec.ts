/**
 * Case-report email compose dialog (browser-only smoke test).
 *
 * Drives the report page's "Email draft" flow against a fake Tauri IPC
 * (canned SQL rows + a 1x1 JPEG for the photo bytes), covering the compose
 * dialog added for clinician-customised emails:
 *
 *  - opening prefills To (patient email), subject and the default HTML body
 *  - the Preview tab renders the draft HTML inside the sandboxed iframe
 *  - edits to recipient/subject reach email_case_report as `custom`, and the
 *    dialog closes on a successful handoff
 *  - cancelling keeps the clinician's edits for the next attempt
 *  - responsive audit: the dialog fits the viewport with no horizontal
 *    scroll at phone, small-window, square and desktop sizes, and the
 *    footer actions stay reachable.
 *
 * The userAgent is pinned to a macOS string so the platform-gated Email
 * draft button renders on any host OS.
 */
import { expect, test, type Page } from '@playwright/test';

// 1x1 pixel JPEG — enough for downscaleImageDataUrl to pass through.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/2gAMAwEAAhEDEQA/AKpgA//Z';

declare global {
  interface Window {
    __TAURI_INTERNALS__: Record<string, unknown>;
    __camogCalls: { cmd: string; args: Record<string, unknown> }[];
  }
}

const PATIENT_ROW = {
  id: 'p1', name: 'Joe Sample', normalized_name: 'joe sample', dob: null,
  email: 'joe@example.com', photo_count: 1, deleted_photo_count: 0,
  created_at: Date.now() - 86400000, updated_at: Date.now() - 3600000,
  last_photo_at: Date.now() - 3600000, clinician_id: 'c1',
  is_archived: 0, archived_at: null, owner_clinician_id: 'c1', is_org_shared: 0,
  consent_given_at: Date.now() - 86400000, consent_scope: 'care',
  consent_expires_at: null, review_due_at: null, last_reviewed_at: null,
  owner_name: 'Dr X',
};

const PHOTO_ROW = {
  id: 'ph1', patient_id: 'p1', original_file_name: 'face.jpg',
  mime_type: 'image/jpeg', file_size_bytes: 631,
  body_part: 'face', laterality: null, subpart: 'Cheek',
  clinical_notes: 'Stable border.', pin_x: null, pin_y: null,
  pin_space: null, pin_view: null, review_due_at: null, last_reviewed_at: null,
  lesion_group: null, attachment_count: 0, image_path: 'ph1.jpg',
  thumbnail_path: 'ph1-thumb.jpg', captured_at: Date.now() - 3600000,
  created_at: Date.now() - 3600000, updated_at: Date.now() - 3600000,
  clinician_id: 'c1', is_deleted: 0, deleted_at: null,
};

test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });

/** Fake Tauri IPC: canned SQL rows, in-memory photo bytes, recorded invokes. */
async function openReportPage(page: Page): Promise<void> {
  await page.addInitScript(({ patientRow, photoRow, jpegB64 }) => {
    sessionStorage.setItem('camog.session', JSON.stringify({ clinicianId: 'c1', expiresAt: Date.now() + 3600000 }));
    const settings = { id: 'app', photos_dir: null, review_warning_days: 7, review_stale_days: 90, allow_public_signup: 1, logo_data_url: `data:image/jpeg;base64,${jpegB64}`, org_name: 'Clinic', session_timeout_ms: 1800000, idle_lock_timeout_ms: 300000 };
    const clinician = { id: 'c1', username: 'drx', display_name: 'Dr X', role: 'admin', is_active: 1, is_pending: 0, must_change_passcode: 0, preferences: '{}', created_at: Date.now(), last_login_at: Date.now() };
    window.__camogCalls = [];
    const bytes = Uint8Array.from(atob(jpegB64), (c) => c.charCodeAt(0));
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      plugins: {},
      transformCallback: () => Math.floor(Math.random() * 1e6),
      invoke: (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
        window.__camogCalls.push({ cmd, args: args ?? {} });
        const q = String(args?.query || '').toLowerCase();
        if (cmd === 'plugin:sql|select') {
          // Order matters: the patient query embeds a COUNT(*) subselect, so
          // the table checks must run before the generic count( branch.
          if (q.includes('from patients p')) return Promise.resolve([patientRow]);
          if (q.includes('from photos')) return Promise.resolve([photoRow]);
          if (q.includes('count(')) return Promise.resolve([{ n: 1 }]);
          if (q.includes('from settings')) return Promise.resolve([settings]);
          if (q.includes('from clinicians')) return Promise.resolve([clinician]);
          if (q.includes('from audit_log')) return Promise.resolve([]);
          return Promise.resolve([]);
        }
        if (cmd === 'plugin:sql|execute') return Promise.resolve([1, 0]);
        if (cmd === 'email_case_report') return Promise.resolve({ pageCount: 2, handoff: 'mapi' });
        if (cmd === 'photo_decrypt_bytes') return Promise.resolve(args?.b64);
        if (cmd === 'plugin:fs|read_file') return Promise.resolve(bytes);
        if (cmd === 'plugin:path|join') return Promise.resolve((args?.paths as string[]).join('/'));
        if (cmd === 'remote_camera_active') return Promise.resolve(null);
        if (cmd === 'get_phone_link_remember') return Promise.resolve(false);
        if (cmd === 'remote_camera_idle_ms') return Promise.resolve(0);
        if (cmd?.startsWith('plugin:event|')) return Promise.resolve(Math.floor(Math.random() * 1e6));
        if (cmd?.startsWith('plugin:path|')) return Promise.resolve('/tmp');
        if (cmd?.startsWith('plugin:fs|')) return Promise.resolve(cmd.includes('exists') ? true : null);
        if (cmd?.startsWith('plugin:dialog|')) return Promise.resolve(null);
        return Promise.resolve(null);
      },
    };
  }, { patientRow: PATIENT_ROW, photoRow: PHOTO_ROW, jpegB64: TINY_JPEG_B64 });

  await page.goto('/patients/report?id=p1');
  await expect(page.getByRole('button', { name: 'Email draft' })).toBeVisible({ timeout: 15000 });
}

/** Opens the compose dialog and waits for the prefilled form. */
async function openComposeDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Email draft' }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Email case report');
}

/** The dialog must sit fully inside the viewport with no horizontal scroll. */
async function expectDialogFitsViewport(page: Page): Promise<void> {
  const vp = page.viewportSize();
  expect(vp).toBeTruthy();
  const box = await page.locator('[role="dialog"]').boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 0.5);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Open email draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
}

test('compose dialog opens on Preview, prefills the draft and hands the custom wording to email_case_report', async ({ page }) => {
  await openReportPage(page);
  await openComposeDialog(page);

  // Preview is the default view (most users don't read HTML): the rendered
  // email shows immediately in the sandboxed iframe.
  const frame = page.frameLocator('iframe[title="Email preview"]');
  await expect(frame.locator('body')).toContainText('A clinical photo report for Joe Sample is attached as a PDF.');
  await expect(frame.locator('strong')).toHaveText('Joe Sample');
  // The clinic logo (Settings branding) rides inside the email as a data
  // URI, with the clinic name as its alt-text fallback.
  await expect(frame.locator('img')).toHaveAttribute('src', new RegExp(`data:image/jpeg;base64,${TINY_JPEG_B64.slice(0, 16)}`));
  await expect(frame.locator('img')).toHaveAttribute('alt', 'Clinic');

  // The Write tab holds the editable HTML source with the same prefill.
  await page.getByRole('tab', { name: 'Write' }).click();
  await expect(page.locator('#email-to')).toHaveValue('joe@example.com');
  await expect(page.locator('#email-subject')).toHaveValue('Clinical photo report — Joe Sample');
  await expect(page.locator('#email-body')).toHaveValue(/<strong>Joe Sample<\/strong>/);
  await expect(page.locator('#email-body')).toHaveValue(/is attached as a PDF/);

  // Edits reach the Rust command as the custom draft.
  await page.locator('#email-to').fill('referral@clinic.example');
  await page.locator('#email-subject').fill('Wound review photos for Joe');
  await page.locator('#email-body').fill('<html><body><p>Hi Joe, your photos are attached.</p></body></html>');
  await page.getByRole('button', { name: 'Open email draft' }).click();

  const emailCall = await page.evaluate(() =>
    window.__camogCalls.find((c) => c.cmd === 'email_case_report')
  );
  expect(emailCall).toBeTruthy();
  expect(emailCall!.args.recipient).toBe('referral@clinic.example');
  expect(emailCall!.args.custom).toEqual({
    subject: 'Wound review photos for Joe',
    bodyHtml: '<html><body><p>Hi Joe, your photos are attached.</p></body></html>',
  });
  expect(emailCall!.args.request).toMatchObject({ patientName: 'Joe Sample' });

  // A successful handoff closes the dialog.
  await expect(page.locator('[role="dialog"]')).toBeHidden();
});

test('cancelling keeps the clinician edits for the next attempt', async ({ page }) => {
  await openReportPage(page);
  await openComposeDialog(page);

  await page.locator('#email-subject').fill('Kept across cancel');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden();

  await page.getByRole('button', { name: 'Email draft' }).click();
  await expect(page.locator('#email-subject')).toHaveValue('Kept across cancel');
});

test('default draft follows the app theme (dark settings tint the message)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openReportPage(page);
  await openComposeDialog(page);

  // Opens on Preview; switch to Write to inspect the generated source.
  await page.getByRole('tab', { name: 'Write' }).click();
  // Dark app theme → the template carries the app's dark zinc palette.
  await expect(page.locator('#email-body')).toHaveValue(/background-color: #09090b/);
  await expect(page.locator('#email-body')).toHaveValue(/color: #fafafa/);

  // The preview paints the dark message, not a white panel.
  await page.getByRole('tab', { name: 'Preview' }).click();
  const frame = page.frameLocator('iframe[title="Email preview"]');
  await expect(frame.locator('body')).toContainText('A clinical photo report for Joe Sample is attached as a PDF.');
});

test('compose dialog stays usable and inside the viewport at any window size', async ({ page }) => {
  await openReportPage(page);

  const sizes: Array<{ width: number; height: number }> = [
    { width: 375, height: 667 }, // phone-width column
    { width: 540, height: 400 }, // short small window: dialog must scroll internally
    { width: 800, height: 600 }, // square
    { width: 1280, height: 800 }, // desktop
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await openComposeDialog(page);
    await expectDialogFitsViewport(page);

    // Both message modes must fit too: the source editor and the preview.
    // (The dialog keeps its tab across reopens, so switch explicitly.)
    await page.getByRole('tab', { name: 'Write' }).click();
    await expect(page.locator('#email-body')).toBeVisible();
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expectDialogFitsViewport(page);
    const frameBox = await page.locator('iframe[title="Email preview"]').boundingBox();
    expect(frameBox).toBeTruthy();
    expect(frameBox!.width).toBeGreaterThan(0);
    expect(frameBox!.height).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[role="dialog"]')).toBeHidden();
  }
});
