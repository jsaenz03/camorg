import { defineConfig, devices } from '@playwright/test';

// Browser-only smoke suite: storage/auth calls go through Tauri IPC and fail
// outside the desktop shell, so these specs cover what a plain webview can
// verify (rendering, routing guards, form validation). Storage-backed flows
// stay covered by scripts/run-self-checks.sh + manual test passes.

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3434',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3434',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
