# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: capture-with-data.spec.ts >> Capture Page - Photo with Dummy Data >> capture photo and fill metadata form with dummy data
- Location: tests/capture-with-data.spec.ts:4:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=John Doe').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=John Doe').first()

```

```yaml
- heading "Patients" [level=1]
- paragraph: View and search patient records
- searchbox "Search patients by name..."
- img
- heading "Error loading patients" [level=3]
- paragraph: Cannot read properties of undefined (reading 'invoke')
- alert
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Capture Page - Photo with Dummy Data', () => {
  4   |   test('capture photo and fill metadata form with dummy data', async ({ page }) => {
  5   |     await page.goto('http://localhost:3001/capture');
  6   |     await page.waitForLoadState('networkidle');
  7   | 
  8   |     // Check page loads
  9   |     await expect(page.locator('h1')).toContainText('Capture Photo');
  10  | 
  11  |     // Mock camera stream via browser context
  12  |     await page.addInitScript(() => {
  13  |       const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  14  |       navigator.mediaDevices.getUserMedia = async (constraints) => {
  15  |         const canvas = document.createElement('canvas');
  16  |         canvas.width = 640;
  17  |         canvas.height = 480;
  18  |         const ctx = canvas.getContext('2d');
  19  |         if (ctx) {
  20  |           ctx.fillStyle = '#667eea';
  21  |           ctx.fillRect(0, 0, 640, 480);
  22  |           ctx.fillStyle = '#fff';
  23  |           ctx.font = '48px Arial';
  24  |           ctx.textAlign = 'center';
  25  |           ctx.fillText('TEST PHOTO', 320, 240);
  26  |         }
  27  |         const stream = canvas.captureStream(30);
  28  |         return stream;
  29  |       };
  30  |     });
  31  | 
  32  |     // Wait for camera to initialize
  33  |     await page.waitForTimeout(3000);
  34  | 
  35  |     // Click capture button
  36  |     const captureButton = page.locator('button:has-text("Capture"), button:has-text("Take Photo")').first();
  37  |     if (await captureButton.isVisible({ timeout: 5000 })) {
  38  |       await captureButton.click();
  39  |       await page.waitForTimeout(2000);
  40  |     }
  41  | 
  42  |     // Wait for photo to be captured and form to appear
  43  |     await page.waitForTimeout(2000);
  44  | 
  45  |     // Fill in dummy patient data
  46  |     const dummyPatientName = 'John Doe';
  47  |     const dummyBodyPart = 'Arm';
  48  |     const dummySubpart = 'Left Forearm';
  49  |     const dummyClinicalNotes = 'Test clinical photo for documentation purposes. No abnormalities detected.';
  50  | 
  51  |     // Fill patient name
  52  |     const patientNameInput = page.locator('input[name="patientName"]').first();
  53  |     if (await patientNameInput.isVisible({ timeout: 3000 })) {
  54  |       await patientNameInput.fill(dummyPatientName);
  55  |     }
  56  | 
  57  |     // Select body part
  58  |     const bodyPartSelect = page.locator('[role="combobox"]:near(:text("Body Part"))').first();
  59  |     if (await bodyPartSelect.isVisible({ timeout: 3000 })) {
  60  |       await bodyPartSelect.click();
  61  |       await page.waitForTimeout(500);
  62  |       const armOption = page.locator('[role="option"]:has-text("Arm")').first();
  63  |       if (await armOption.isVisible()) {
  64  |         await armOption.click();
  65  |       }
  66  |     }
  67  | 
  68  |     // Fill subpart
  69  |     const subpartInput = page.locator('input[name="subpart"]').first();
  70  |     if (await subpartInput.isVisible({ timeout: 3000 })) {
  71  |       await subpartInput.fill(dummySubpart);
  72  |     }
  73  | 
  74  |     // Fill clinical notes
  75  |     const notesInput = page.locator('textarea[name="clinicalNotes"]').first();
  76  |     if (await notesInput.isVisible({ timeout: 3000 })) {
  77  |       await notesInput.fill(dummyClinicalNotes);
  78  |     }
  79  | 
  80  |     // Click save button
  81  |     const saveButton = page.locator('button[type="submit"]:has-text("Save")').first();
  82  |     if (await saveButton.isVisible({ timeout: 3000 })) {
  83  |       await saveButton.click();
  84  |       await page.waitForTimeout(3000);
  85  | 
  86  |       // Check for success toast
  87  |       const toast = page.locator('[data-sonner-toast], [role="alert"]').first();
  88  |       if (await toast.isVisible({ timeout: 5000 })) {
  89  |         const toastText = await toast.textContent();
  90  |         expect(toastText).toContain('success');
  91  |       }
  92  |     }
  93  | 
  94  |     // Navigate to patients page to verify data was saved
  95  |     await page.goto('http://localhost:3001/patients');
  96  |     await page.waitForLoadState('networkidle');
  97  | 
  98  |     // Check if patient appears in list
> 99  |     await expect(page.locator('text=John Doe').first()).toBeVisible({ timeout: 5000 });
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  100 |   });
  101 | 
  102 |   test('verify patient list shows dummy patient after creation', async ({ page }) => {
  103 |     await page.goto('http://localhost:3001/patients');
  104 |     await page.waitForLoadState('networkidle');
  105 | 
  106 |     // Search for dummy patient
  107 |     const searchInput = page.locator('input[type="search"]').first();
  108 |     if (await searchInput.isVisible({ timeout: 3000 })) {
  109 |       await searchInput.fill('John Doe');
  110 |       await page.waitForTimeout(500);
  111 |     }
  112 | 
  113 |     // Verify patient card exists
  114 |     await expect(page.locator('text=John Doe').first()).toBeVisible({ timeout: 5000 });
  115 |   });
  116 | });
```