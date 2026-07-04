import { test, expect } from '@playwright/test';

test.describe('Capture Page - Photo with Dummy Data', () => {
  test('capture photo and fill metadata form with dummy data', async ({ page }) => {
    await page.goto('http://localhost:3001/capture');
    await page.waitForLoadState('networkidle');

    // Check page loads
    await expect(page.locator('h1')).toContainText('Capture Photo');

    // Mock camera stream via browser context
    await page.addInitScript(() => {
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#667eea';
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = '#fff';
          ctx.font = '48px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('TEST PHOTO', 320, 240);
        }
        const stream = canvas.captureStream(30);
        return stream;
      };
    });

    // Wait for camera to initialize
    await page.waitForTimeout(3000);

    // Click capture button
    const captureButton = page.locator('button:has-text("Capture"), button:has-text("Take Photo")').first();
    if (await captureButton.isVisible({ timeout: 5000 })) {
      await captureButton.click();
      await page.waitForTimeout(2000);
    }

    // Wait for photo to be captured and form to appear
    await page.waitForTimeout(2000);

    // Fill in dummy patient data
    const dummyPatientName = 'John Doe';
    const dummyBodyPart = 'Arm';
    const dummySubpart = 'Left Forearm';
    const dummyClinicalNotes = 'Test clinical photo for documentation purposes. No abnormalities detected.';

    // Fill patient name
    const patientNameInput = page.locator('input[name="patientName"]').first();
    if (await patientNameInput.isVisible({ timeout: 3000 })) {
      await patientNameInput.fill(dummyPatientName);
    }

    // Select body part
    const bodyPartSelect = page.locator('[role="combobox"]:near(:text("Body Part"))').first();
    if (await bodyPartSelect.isVisible({ timeout: 3000 })) {
      await bodyPartSelect.click();
      await page.waitForTimeout(500);
      const armOption = page.locator('[role="option"]:has-text("Arm")').first();
      if (await armOption.isVisible()) {
        await armOption.click();
      }
    }

    // Fill subpart
    const subpartInput = page.locator('input[name="subpart"]').first();
    if (await subpartInput.isVisible({ timeout: 3000 })) {
      await subpartInput.fill(dummySubpart);
    }

    // Fill clinical notes
    const notesInput = page.locator('textarea[name="clinicalNotes"]').first();
    if (await notesInput.isVisible({ timeout: 3000 })) {
      await notesInput.fill(dummyClinicalNotes);
    }

    // Click save button
    const saveButton = page.locator('button[type="submit"]:has-text("Save")').first();
    if (await saveButton.isVisible({ timeout: 3000 })) {
      await saveButton.click();
      await page.waitForTimeout(3000);

      // Check for success toast
      const toast = page.locator('[data-sonner-toast], [role="alert"]').first();
      if (await toast.isVisible({ timeout: 5000 })) {
        const toastText = await toast.textContent();
        expect(toastText).toContain('success');
      }
    }

    // Navigate to patients page to verify data was saved
    await page.goto('http://localhost:3001/patients');
    await page.waitForLoadState('networkidle');

    // Check if patient appears in list
    await expect(page.locator('text=John Doe').first()).toBeVisible({ timeout: 5000 });
  });

  test('verify patient list shows dummy patient after creation', async ({ page }) => {
    await page.goto('http://localhost:3001/patients');
    await page.waitForLoadState('networkidle');

    // Search for dummy patient
    const searchInput = page.locator('input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.fill('John Doe');
      await page.waitForTimeout(500);
    }

    // Verify patient card exists
    await expect(page.locator('text=John Doe').first()).toBeVisible({ timeout: 5000 });
  });
});