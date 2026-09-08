// Runnable check for the licence activation dialog overflow.
// Run after `npm run build`:  npx playwright test --config=scripts/licence-dialog-check.config.ts
//
// Loads the app's real compiled CSS into a bare page, rebuilds the dialog
// DOM with the exact class strings from
// components/licence/licence-activation-dialog.tsx, pastes a long unbroken
// licence key, and asserts the textarea stays inside the dialog.
import { readFileSync } from 'fs';
import { test, expect, type Page } from '@playwright/test';

// Load the compiled CSS in the order the app actually applies it: the <link>
// order of a built page. (Reading the chunks directory instead made the
// cascade depend on chunk-hash sort order — a rebuild could flip which
// field-sizing rule wins and fail this check spuriously.)
const APP_CSS = Array.from(
  readFileSync('out/legal/index.html', 'utf8').matchAll(/href="(\/_next\/static\/chunks\/[^"]+\.css)"/g),
  (m) => readFileSync(`out${m[1]}`, 'utf8'),
).join('\n');

const HTML = (css: string) => `<!doctype html><html><head><style>${css}
  body{margin:0}</style></head><body>
  <div id="dlg" data-slot="dialog-content" class="bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-md">
    <div class="flex flex-col gap-2 text-center sm:text-left">
      <div class="text-lg leading-none font-semibold">Activate Camog</div>
    </div>
    <div class="space-y-3">
      <textarea id="key" data-slot="textarea" rows="5"
        class="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm font-mono text-xs CLS"></textarea>
    </div>
  </div>
  <script>
    const part = () => Array.from({length: 48}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Math.floor(Math.random()*64)]).join('');
    document.getElementById('key').value = 'CAMOG1.' + part() + '.' + part();
  </script></body></html>`;

async function measure(page: Page, variant: 'old' | 'new') {
  await page.setContent(HTML(APP_CSS));
  // Emulate exactly what twMerge emits per variant (verified with
  // tailwind-merge v3.3.1): the OLD arbitrary-property class survives
  // alongside the base field-sizing-content; the NEW named utility
  // field-sizing-fixed replaces it.
  await page.evaluate((v: string) => {
    const ta = document.getElementById('key')!;
    if (v === 'new') ta.className = ta.className.replace(' field-sizing-content', '');
    ta.className = ta.className.replace('CLS', v === 'old' ? '[field-sizing:fixed]' : 'field-sizing-fixed');
  }, variant);
  return page.evaluate(() => {
    const ta = document.getElementById('key')!;
    const dlg = document.getElementById('dlg')!;
    return {
      fieldSizing: getComputedStyle(ta).getPropertyValue('field-sizing'),
      taWidth: Math.round(ta.getBoundingClientRect().width),
      dlgWidth: Math.round(dlg.getBoundingClientRect().width),
      overflowsViewport: dlg.getBoundingClientRect().right > window.innerWidth,
    };
  });
}

test('old [field-sizing:fixed] loses the cascade — textarea overshoots the dialog', async ({ page }) => {
  const m = await measure(page, 'old');
  expect(m.fieldSizing).toBe('content');
  expect(m.taWidth, 'bug: textarea wider than the dialog').toBeGreaterThan(m.dlgWidth);
});

test('field-sizing-fixed contains the key inside the dialog', async ({ page }) => {
  const m = await measure(page, 'new');
  expect(m.fieldSizing).toBe('fixed');
  expect(m.dlgWidth).toBeLessThanOrEqual(449); // sm:max-w-md = 28rem
  expect(m.taWidth, 'textarea must stay inside the dialog padding box').toBeLessThanOrEqual(m.dlgWidth - 48); // p-6*2
  expect(m.overflowsViewport).toBe(false);
});
