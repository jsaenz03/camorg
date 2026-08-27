/**
 * Browser-only smoke suite.
 *
 * Storage/auth calls go through Tauri IPC and fail outside the desktop
 * shell, so these specs assert what a plain webview can verify: pages
 * render, the auth gate redirects, and form validation fires. Deep
 * storage-backed flows are covered by scripts/run-self-checks.sh and
 * manual desktop passes.
 */

import { test, expect } from '@playwright/test';

test.describe('login screen', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Enter your credentials to continue')).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Passcode')).toBeVisible();
  });

  test('empty submit shows validation messages', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible();
  });

  test('remember-me copy promises username-only storage', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('passcode is never stored', { exact: false })).toBeVisible();
  });
});

test.describe('auth gate', () => {
  test('dashboard pages redirect to /login without a session', async ({ page }) => {
    await page.goto('/capture');
    await expect(page).toHaveURL(/\/login\/?$/, { timeout: 20_000 });
  });
});

test.describe('signup screen', () => {
  // Outside the Tauri shell the settings fetch fails and the page falls back
  // to the invite-only posture — which must always expose the code field (the
  // "nowhere to put the token" regression).
  test('invite-code entry is reachable', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByText('Enter the code your administrator gave you')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. ABCD1234')).toBeVisible();
  });
});
