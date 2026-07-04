import { test, expect } from '@playwright/test';

test('app loads successfully', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page).toHaveTitle(/Camog/);
});

test('dashboard patients page loads', async ({ page }) => {
  await page.goto('http://localhost:3000/patients');
  await expect(page.locator('h1')).toContainText('Patients');
});

test('capture page loads', async ({ page }) => {
  await page.goto('http://localhost:3000/capture');
  await expect(page.locator('body')).toBeVisible();
});

test('search page loads', async ({ page }) => {
  await page.goto('http://localhost:3000/search');
  await expect(page.locator('body')).toBeVisible();
});

test('no console errors on dashboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  
  await page.goto('http://localhost:3000/patients');
  await page.waitForLoadState('networkidle');
  
  expect(errors.filter(e => !e.includes('favicon') && !e.includes('chrome-extension')).length).toBe(0);
});
