// Render-feature-shots — produces 2048-wide "captures" of the 0.8.0 feature
// screens for the Store listing frames. Unlike the raw macOS captures in this
// folder these are rendered straight from the app's own compiled CSS (the
// technique of scripts/licence-dialog-overflow.check.spec.ts): the DOM is
// transcribed from the real components with demo data, so the frames are
// component-faithful AND carry no macOS title bar by construction — a raw
// macOS-styled capture fails Store policy 10.1.1.3.
//
// Geometry matches the existing raw captures: 2048×1176 windows at device
// ratio 1 (the old captures are DPR-1 screenshots of a 2048-wide window),
// 57 px of title bar cropped off exactly like make-store-assets does.
//
// Run after `npm run build` (reads out/_next CSS + fonts):
//   node scripts/render-feature-shots.mjs
// Then re-run scripts/make-store-assets.mjs to rebuild the listing frames
// (the new shots are SHOTS entries with crop: 0).
//
// Requires @playwright/test (chromium is already in the playwright cache).

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');
const SHOTS_DIR = join(ROOT, 'guide', 'store-assets', 'screenshots');
const VIEW = { w: 2048, h: 1119 }; // capture minus the 57 px title bar
const TITLE_BAR = 57;

// ---------------------------------------------------------------------------
// Real compiled CSS, with the /_next font URLs rewritten to file:// so the
// page renders in the app's actual typeface. Same load order as a built page.
// ---------------------------------------------------------------------------
const APP_CSS = Array.from(
  readFileSync(join(OUT, 'legal/index.html'), 'utf8').matchAll(
    /href="(\/_next\/static\/chunks\/[^"]+\.css)"/g,
  ),
  (m) =>
    readFileSync(join(OUT, m[1]), 'utf8').replaceAll(
      'url(/_next/static/media/',
      `url(file://${join(OUT, '_next/static/media/')}`,
    ),
).join('\n');

// ---------------------------------------------------------------------------
// Inline lucide icons (24×24, stroke) — only the ones the frames show.
// ---------------------------------------------------------------------------
const I = {
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  penline:
    '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  calcheck:
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  panelleft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  shieldcheck:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  layoutdashboard:
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  badgecheck:
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
};

const icon = (name, cls = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${I[name]}</svg>`;

// The ClinicIQ brand glyph from the app's sidebar (public/logo.png).
const LOGO = `file://${join(ROOT, 'public/logo.png')}`;

// The demo hand photo lives inside the approved raw capture — reuse it.
const CAPTURE2 = `file://${join(SHOTS_DIR, '02-photo-detail-result-files.png')}`;

// ---------------------------------------------------------------------------
// Shared demo data (matches the approved listing captures: Mister Sample,
// left-hand photo, "My Test Clinic" licence)
// ---------------------------------------------------------------------------
const DEMO = {
  clinician: { name: 'Sam Sample', role: 'admin', initial: 'S' },
  licence: {
    to: 'My Test Clinic',
    tier: 'Practice',
    seats: '3',
    expires: '23/08/2027',
    device: 'dcb6355d-70b8-4572-ab9d-bafc4480753d',
  },
  templates: [
    { title: 'No change', shortcut: 'ncp', body: 'Reviewed {date} — no change since the previous photo; lesion stable in size, shape and colour.' },
    { title: 'Increased in size', shortcut: null, body: 'Lesion has increased in size since the previous photo; review recommended.' },
    { title: 'Colour or border change', shortcut: null, body: 'Change in colour or border noted; monitor closely and consider earlier review.' },
    { title: 'Benign — no intervention', shortcut: null, body: 'Benign-appearing lesion; no intervention required at this time.' },
    { title: 'No symptoms', shortcut: 'nsy', body: '{patient} reports no pain, itching or bleeding at the {bodypart} site.' },
    { title: 'Wound healing', shortcut: null, body: 'Wound healing well; no signs of infection.' },
    { title: 'Baseline recorded', shortcut: 'bsl', body: 'Baseline photo of the {bodypart} recorded for comparison; follow-up photo recommended in 3 months.' },
    { title: 'Referral note', shortcut: null, body: 'Photos of the {bodypart} forwarded for specialist opinion on {date}.' },
  ],
};

// Sidebar + top bar — transcribed from the dashboard shell as seen in the
// existing approved captures (ClinicIQ branding, counts 7/7, admin avatar).
function shell(main, { activeNav = 'Settings' } = {}) {
  const nav = (iconName, label, badge, active) => `
    <a class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}">
      ${icon(iconName, 'size-4 shrink-0')}${label}
      ${badge ? `<span class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1 text-[10px] font-medium text-muted-foreground">${badge}</span>` : ''}
    </a>`;
  const section = (label) =>
    `<p class="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">${label}</p>`;
  return `
  <div class="flex h-full w-full bg-background text-foreground">
    <aside class="flex w-[250px] shrink-0 flex-col border-r bg-sidebar px-3 pb-3 text-sm">
      <div class="flex items-center gap-2 px-1 py-4">
        <img src="${LOGO}" class="size-8" />
        <div class="leading-tight">
          <p class="text-base font-semibold">ClinicIQ</p>
          <p class="text-xs text-muted-foreground">Clinical Photos</p>
        </div>
      </div>
      ${section('Workspace')}${nav('layoutdashboard', 'Dashboard', '7', activeNav === 'Dashboard')}
      ${section('Library')}${nav('users', 'Patients', '7', activeNav === 'Patients')}${nav('image', 'Photos', '', activeNav === 'Photos')}
      ${section('Account')}${nav('settings', 'Settings', '', activeNav === 'Settings')}
      <div class="mt-auto flex items-center gap-2 rounded-md p-2">
        <span class="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">${DEMO.clinician.initial}</span>
        <div class="leading-tight">
          <p class="truncate text-sm font-medium">${DEMO.clinician.name}</p>
          <p class="text-xs text-muted-foreground">${DEMO.clinician.role}</p>
        </div>
      </div>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <span class="text-muted-foreground">${icon('panelleft', 'size-4')}</span>
        <span class="flex items-center gap-4 text-muted-foreground">${icon('moon', 'size-4')}${icon('shieldcheck', 'size-4')}</span>
      </header>
      <main class="min-h-0 flex-1 overflow-hidden">${main}</main>
    </div>
  </div>`;
}

function settingsPage(tabs, activeTab, card) {
  const tab = (label) => {
    const active = label === activeTab;
    return `<button class="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
      active
        ? 'bg-background text-foreground'
        : 'text-muted-foreground'
    }" ${active ? 'style="box-shadow:0 0 0 1.5px #0F3B40"' : ''}>${label}</button>`;
  };
  return shell(`
  <div class="mx-auto h-full overflow-hidden px-4 pt-8" style="max-width:768px">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
        <p class="mt-1 text-sm text-muted-foreground">Manage your profile and application preferences.</p>
      </div>
      <span class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">admin</span>
    </div>
    <div class="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
      ${tabs.map(tab).join('')}
    </div>
    <div class="mt-6 rounded-lg border bg-card text-card-foreground shadow-sm">
      ${card}
    </div>
  </div>`);
}

// A shadcn-style Switch in its checked state.
const switchOn = `
  <span class="inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-primary">
    <span class="block size-4 translate-x-4 rounded-full bg-background shadow-sm"></span>
  </span>`;

// ---------------------------------------------------------------------------
// Frame 1 — photo record with the template popover open over clinical notes
// ---------------------------------------------------------------------------
function photoNotesFrame() {
  // Dialog transcribed from components/photo/photo-detail-dialog.tsx (its
  // 1000×880 box at this window size), scrolled to the lesion-series /
  // subpart / notes sections with the Quick text picker open.
  const popoverRow = (t) => `
    <div class="w-full rounded-md px-2 py-1.5">
      <span class="flex items-center gap-2">
        <span class="text-sm font-medium">${t.title}</span>
        ${t.shortcut ? `<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold">${t.shortcut}</span>` : ''}
      </span>
      <span class="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">${t.body}</span>
    </div>`;
  const popover = `
  <div class="absolute right-0 top-8 z-50 w-80 rounded-md border bg-popover p-1 text-popover-foreground" style="box-shadow:0 16px 40px rgba(6,60,68,0.20);max-height:256px;overflow:hidden">
    ${DEMO.templates.slice(0, 4).map(popoverRow).join('')}
    <p class="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
      Type a shortcut then Space to expand it. {date} {patient} {bodypart} fill in automatically.
    </p>
  </div>`;
  const notesValue =
    'Reviewed 31/08/2026 — no change since the previous photo; lesion stable in size, shape and colour. Mister Sample reports no pain, itching or bleeding at the left hand site.';
  const meta = `
  <div class="flex min-h-0 min-w-0 flex-col border-l">
    <div class="min-h-0 min-w-0 flex-1 space-y-4 overflow-hidden p-6">
      <div class="space-y-2">
        <p class="text-sm font-medium leading-none">Lesion series</p>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs" value="Left palm lesion — before/after" />
        <p class="text-xs text-muted-foreground">Photos in a series badge together in the timeline.</p>
      </div>
      <div class="space-y-2">
        <p class="text-sm font-medium leading-none">Subpart</p>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs" value="palm, centre" />
        <div class="flex flex-wrap gap-1.5 pt-1.5">
          ${['left palm', 'thumb base']
            .map((s) => `<span class="inline-flex items-center rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">${s}</span>`)
            .join('')}
        </div>
      </div>
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium leading-none">Clinical notes</p>
          <span class="relative">
            <span class="inline-flex h-7 whitespace-nowrap items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground">${icon('sparkles', 'size-3.5')}Quick text</span>
            ${popover}
          </span>
        </div>
        <textarea class="flex min-h-32 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs" style="height:128px">${notesValue}</textarea>
        <p class="text-right text-xs text-muted-foreground">${notesValue.length}/2000</p>
      </div>
      <div class="space-y-2 rounded-md border p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium">Review</p>
          <button class="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs">${icon('calcheck', 'size-4')}Mark reviewed</button>
        </div>
      </div>
    </div>
  </div>`;
  const dialog = `
  <div class="flex flex-col overflow-hidden rounded-lg border bg-background" style="width:1030px;height:890px;box-shadow:0 24px 70px rgba(6,60,68,0.28)">
    <div class="shrink-0 border-b p-6">
      <div class="flex flex-wrap items-center gap-2 pr-8 text-base font-semibold relative">
        <span class="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">Left Hand</span>
        <span class="text-sm font-normal text-muted-foreground">Aug 31, 2026 at 10:12 PM</span>
        <span class="absolute right-0 top-0 opacity-70">${icon('x', 'size-5')}</span>
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden" style="display:grid;grid-template-columns:1.4fr 1fr">
      <div class="relative flex items-center justify-center p-4" style="background:rgba(0,0,0,0.95)">
        <div class="h-full w-full" style="
          background-image:url('${CAPTURE2}');
          background-repeat:no-repeat;
          /* the hand region of the source capture, in source coordinates */
          background-size:2972px 1706px;
          background-position:-900px -522px;"></div>
        <button class="inline-flex h-8 items-center gap-1.5 rounded-md bg-secondary px-3 text-sm font-medium shadow-xs" style="position:absolute;left:16px;top:16px">${icon('penline', 'size-4')}Annotate</button>
      </div>
      <form class="flex min-h-0 min-w-0 flex-col border-l">${meta}</form>
    </div>
    <div class="flex shrink-0 items-center justify-between border-t p-4">
      <button class="inline-flex h-9 items-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-white">${icon('trash', 'size-4')}Delete</button>
      <button class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Save changes</button>
    </div>
  </div>`;
  // Backdrop: the approved raw capture with its title bar cropped off (the
  // same 57 px make-store-assets cuts), dialog laid exactly over the old
  // dialog's box so no ghost edges peek through.
  const page = `
  <div class="relative overflow-hidden bg-background" style="width:${VIEW.w}px;height:${VIEW.h}px">
    <div style="position:absolute;left:0;top:0;width:${VIEW.w}px;height:${VIEW.h}px;overflow:hidden">
      <img src="${CAPTURE2}" style="width:${VIEW.w}px;height:auto;margin-top:-${TITLE_BAR}px;max-width:none" />
    </div>
    <div style="position:absolute;left:495px;top:140px">${dialog}</div>
  </div>`;
  return { html: page };
}

// ---------------------------------------------------------------------------
// Frames 2 + 3 — Settings, Templates tab and Licence tab
// ---------------------------------------------------------------------------
function templatesCard() {
  const row = (t) => `
    <li class="flex items-start gap-3 border-b py-3 last:border-b-0">
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-2 text-sm font-medium">
          <span class="truncate">${t.title}</span>
          ${t.shortcut ? `<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold">${t.shortcut}</span>` : ''}
        </p>
        <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">${t.body}</p>
      </div>
      <span class="inline-flex h-8 items-center justify-center rounded-md text-muted-foreground">${icon('penline', 'size-4')}</span>
      <span class="inline-flex h-8 items-center justify-center rounded-md text-muted-foreground">${icon('trash', 'size-4')}</span>
    </li>`;
  return `
  <div class="flex flex-row items-center justify-between gap-2 p-6">
    <div>
      <p class="font-semibold leading-none tracking-tight">Note templates</p>
      <p class="mt-1.5 text-sm text-muted-foreground">Quick-text phrases for clinical notes — yours only, not shared with other clinicians. A template with a shortcut expands when you type the shortcut then Space in a notes field.</p>
    </div>
    <button class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">${icon('plus', 'size-4')}New</button>
  </div>
  <div class="p-6 pt-0">
    <ul class="divide-y">${DEMO.templates.map(row).join('')}</ul>
  </div>`;
}

function licenceCard() {
  const row = (label, value) => `
    <div class="flex items-center justify-between gap-4 border-b py-1.5">
      <span class="text-sm text-muted-foreground">${label}</span>
      <span class="text-sm font-medium">${value}</span>
    </div>`;
  const { to, tier, seats, expires, device } = DEMO.licence;
  return `
  <div class="p-6">
    <p class="flex items-center gap-2 font-semibold leading-none tracking-tight"><span style="color:#007B82">${icon('badgecheck', 'size-5')}</span>Licence</p>
    <p class="mt-1.5 text-sm text-muted-foreground">Camog is licensed on this machine.</p>
  </div>
  <div class="space-y-1 p-6 pt-0">
    ${row('Status', '<span class="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">Licensed</span>')}
    ${row('Licensed to', to)}
    ${row('Tier', tier)}
    ${row('Device seats', seats)}
    ${row('Expires', expires)}
    <div class="flex items-start justify-between gap-4 py-1.5">
      <div class="space-y-0.5">
        <p class="text-sm font-medium">Auto-renew</p>
        <p class="text-xs text-muted-foreground">Installs a renewed licence by itself after each successful payment — nothing to re-enter. Off means the emailed key is activated by hand.</p>
      </div>
      ${switchOn}
    </div>
    ${row('Device ID', `<span class="font-mono text-xs">${device}</span>`)}
    <button class="mt-2 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Change licence key</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rasterise
// ---------------------------------------------------------------------------
const FRAMES = [
  { name: '06-photo-notes.png', html: photoNotesFrame().html },
  {
    name: '07-note-templates.png',
    html: settingsPage(
      ['Profile', 'Templates', 'Users', 'Access', 'Invitations', 'Storage', 'Audit', 'Licence', 'App', 'Diagnostics'],
      'Templates',
      templatesCard(),
    ),
  },
  {
    name: '08-licence-autorenew.png',
    html: settingsPage(
      ['Profile', 'Templates', 'Users', 'Access', 'Invitations', 'Storage', 'Audit', 'Licence', 'App', 'Diagnostics'],
      'Licence',
      licenceCard(),
    ),
  },
];

const browser = await chromium.launch();
let n = 0;
for (const f of FRAMES) {
  const file = join(tmpdir(), `camog-frame-${++n}.html`);
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${APP_CSS}
      html,body{margin:0;padding:0;width:${VIEW.w}px;height:${VIEW.h}px;overflow:hidden;background:#fff}
      ::-webkit-scrollbar{width:0;height:0}
      *{box-sizing:border-box}</style></head><body>${f.html}</body></html>`,
  );
  const page = await browser.newPage({
    viewport: { width: VIEW.w, height: VIEW.h },
    deviceScaleFactor: 1,
  });
  await page.goto('file://' + file);
  await page.waitForTimeout(150); // let the rewritten @font-face files load
  await page.screenshot({ path: join(SHOTS_DIR, f.name) });
  await page.close();
  console.log('rendered', f.name);
}
await browser.close();
console.log('done — feature captures written to guide/store-assets/screenshots/');
