// Make-store-assets — regenerates every brand raster from the vector logo
// master (guide/store-assets/logo-master.svg, built here from the fitted
// geometry of the original mark) plus the Store listing art:
//
//   icons/tiles   src-tauri/icons/*, src-tauri/assets/msix tiles,
//                 src-tauri/assets/logo.png, public/logo.png
//   store art     apptile-300x300, boxart-2160x2160, super-hero-3840x2160,
//                 heading-hero-1920x1080 (guide/store-assets/)
//   screenshots   1920x1080 listing frames from the cleared captures in
//                 guide/store-assets/screenshots/ (macOS title bar cropped
//                 off — the Store listing must not show non-Windows chrome)
//
// Run:  node scripts/make-store-assets.mjs
// Then: python3 scripts/make-app-icons.py   (assembles icon.ico / icon.icns)
//
// Requires @playwright/test (chromium is already in the playwright cache).

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'guide', 'store-assets');
const BUILD = join(ASSETS, 'build');
const ICONS = join(ROOT, 'src-tauri', 'icons');
mkdirSync(BUILD, { recursive: true });

const TEAL = '#007B82';
const INK = '#0F3B40';
const MUTED = '#5B6B70';

// ---------------------------------------------------------------------------
// Vector master — the glyph path is traced from the original bitmap master
// by scripts/trace-logo-path.py (faithful by construction; see README).
// Coordinates live in the original 256-viewBox.
// ---------------------------------------------------------------------------
const TRACED = JSON.parse(readFileSync(join(BUILD, 'glyph-path.json'), 'utf8'));

// centred glyph group for a size×size canvas, glyph scaled to (1 - pad)
function glyphGroup(size, color, pad) {
  const [bx, by, bw, bh] = TRACED.bbox;
  const scale = (size * (1 - pad)) / Math.max(bw, bh);
  const tx = (size - bw * scale) / 2 - bx * scale;
  const ty = (size - bh * scale) / 2 - by * scale;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})">
    <path fill="${color}" d="${TRACED.d}"/>
  </g>`;
}

// standalone glyph SVG in the native 256 viewBox (callers size it via the
// <img> width/height or the enclosing layout — the viewBox scales freely)
function glyphSVG({ color = TEAL }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <path fill="${color}" d="${TRACED.d}"/>
</svg>`;
}

function tileSVG({ size, bg = '#FFFFFF', radius = 0, glyphPad = 0.36, color = TEAL }) {
  // full-bleed tile (square or rounded) with centred glyph
  const r = radius ? size * radius : 0;
  const clip = r
    ? `<clipPath id="t"><rect width="${size}" height="${size}" rx="${r}"/></clipPath>`
    : '';
  const body = `${clip}<rect width="${size}" height="${size}" fill="${bg}" ${r ? 'clip-path="url(#t)"' : ''}/>${glyphGroup(size, color, glyphPad)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Playwright rasteriser
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

let n = 0;
async function render(body, { w, h, out, transparent = false }) {
  const file = join(BUILD, `tmp-${++n}.html`);
  writeFileSync(file, `<!doctype html><html><style>
    @font-face { font-family: Geist; src: url('file://${join(ROOT, 'src-tauri/assets/fonts/Geist-SemiBold.ttf')}'); font-weight: 600; }
    @font-face { font-family: Geist; src: url('file://${join(ROOT, 'src-tauri/assets/fonts/Geist-Medium.ttf')}'); font-weight: 500; }
    @font-face { font-family: Geist; src: url('file://${join(ROOT, 'src-tauri/assets/fonts/Geist-Regular.ttf')}'); font-weight: 400; }
    html,body { margin:0; padding:0; width:${w}px; height:${h}px; overflow:hidden;
      background:${transparent ? 'transparent' : '#fff'}; }
    * { box-sizing: border-box; }
  </style>${body}`);
  await page.setViewportSize({ width: w, height: h });
  await page.goto('file://' + file);
  await page.screenshot({ path: out, omitBackground: transparent });
}

async function renderSVG(svg, opts) {
  await render(`<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"
    style="display:block;width:${opts.w}px;height:${opts.h}px" />`, opts);
}

// ---------------------------------------------------------------------------
// 1. vector master + transparent glyph rasters
// ---------------------------------------------------------------------------
writeFileSync(join(ASSETS, 'logo-master.svg'), glyphSVG({}));

async function glyph(size, out) {
  await renderSVG(glyphSVG({ size }), { w: size, h: size, out, transparent: true });
}
async function tile(size, out, opts = {}) {
  await renderSVG(tileSVG({ size, ...opts }), { w: size, h: size, out, transparent: !!opts.radius });
}

const glyph1024 = join(BUILD, 'glyph-1024.png');
const appicon1024 = join(BUILD, 'appicon-1024.png');
await glyph(1024, glyph1024);
await tile(1024, appicon1024, { radius: 0.225, glyphPad: 0.30 });

// tauri + public masters (transparent glyph, as before)
for (const dest of ['src-tauri/assets/logo.png', 'public/logo.png']) {
  await glyph(1024, join(ROOT, dest));
}

// tauri icon set — same filenames/sizes as `tauri icon` produced
const iconSet = [
  ['32x32.png', 32], ['64x64.png', 64], ['128x128.png', 128], ['128x128@2x.png', 256],
  ['Square30x30Logo.png', 30], ['Square44x44Logo.png', 44], ['Square71x71Logo.png', 71],
  ['Square89x89Logo.png', 89], ['Square107x107Logo.png', 107], ['Square142x142Logo.png', 142],
  ['Square150x150Logo.png', 150], ['Square284x284Logo.png', 284], ['Square310x310Logo.png', 310],
  ['StoreLogo.png', 50], ['icon.png', 512],
];
for (const [name, size] of iconSet) {
  await tile(size, join(ICONS, name), { radius: 0.225, glyphPad: 0.30 });
}

// MSIX package tiles — opaque white square (Windows tiles get their rounding
// from the OS; transparency here is what produced the "black corners")
for (const size of [44, 150]) {
  await tile(size, join(ROOT, 'src-tauri', 'assets', 'msix', `Square${size}x${size}Logo.png`), { glyphPad: 0.32 });
}

// ---------------------------------------------------------------------------
// 2. Store listing art
// ---------------------------------------------------------------------------
await tile(300, join(ASSETS, 'apptile-300x300.png'), { glyphPad: 0.34 });

// boxart — 1:1, may carry the app name (keep it out of the bottom third)
{
  const s = 2160;
  const body = `<div style="width:${s}px;height:${s}px;background:#fff;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:70px;font-family:Geist">
    <img src="data:image/svg+xml;base64,${Buffer.from(glyphSVG({})).toString('base64')}" width="1100" height="1100" />
    <div style="font-size:290px;font-weight:600;color:${INK};line-height:1;letter-spacing:-6px">Camog</div>
    <div style="font-size:74px;font-weight:500;color:${MUTED};letter-spacing:26px">CLINICAL PHOTO DOCUMENTATION</div>
  </div>`;
  await render(body, { w: s, h: s, out: join(ASSETS, 'boxart-2160x2160.png') });
}

// super hero art — 16:9, MUST carry no text and no app UI (Store rule)
{
  const w = 3840, h = 2160;
  const rings = Array.from({ length: 7 }, (_, i) =>
    `<circle cx="2520" cy="1080" r="${420 + i * 210}" fill="none" stroke="rgba(255,255,255,${(0.10 - i * 0.012).toFixed(3)})" stroke-width="3"/>`).join('');
  const body = `<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;
    background:
      radial-gradient(1400px 1400px at 2520px 1080px, rgba(64,208,220,0.28), rgba(0,0,0,0) 62%),
      linear-gradient(128deg, #0B828D 0%, #075E68 52%, #043A42 100%);">
    <div style="position:absolute;inset:0;background:
      linear-gradient(115deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 38%)"></div>
    ${rings}
    <img src="data:image/svg+xml;base64,${Buffer.from(glyphSVG({ color: '#F4FBFC' })).toString('base64')}"
      style="position:absolute; left:640px; top:460px;" width="1240" height="1240" />
    <div style="position:absolute;left:0;right:0;bottom:0;height:26%;background:linear-gradient(rgba(0,0,0,0), rgba(2,32,37,0.55))"></div>
  </div>`;
  await render(body, { w, h, out: join(ASSETS, 'super-hero-3840x2160.png') });
}

// heading hero — 16:9 with wordmark + tagline (website/marketing use; the
// Store's super hero slot does not allow text, so this one is NOT for that slot)
{
  const w = 1920, h = 1080;
  const body = `<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;font-family:Geist;
    background:
      radial-gradient(1100px 1100px at 1450px 540px, rgba(64,208,220,0.30), rgba(0,0,0,0) 62%),
      linear-gradient(128deg, #0B828D 0%, #075E68 55%, #043A42 100%);
    display:flex;align-items:center;">
    ${Array.from({ length: 5 }, (_, i) =>
      `<circle cx="1450" cy="540" r="${300 + i * 130}" fill="none" stroke="rgba(255,255,255,${(0.12 - i * 0.02).toFixed(2)})" stroke-width="2"/>`).join('')}
    <div style="position:absolute;left:110px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;max-width:900px">
      <img src="data:image/svg+xml;base64,${Buffer.from(glyphSVG({ color: '#F4FBFC' })).toString('base64')}"
        style="margin-bottom:34px" width="96" height="96" />
      <div style="font-size:128px;font-weight:600;color:#F4FBFC;line-height:1;letter-spacing:-3px">Camog</div>
      <div style="font-size:40px;font-weight:500;color:rgba(244,251,252,0.92);margin-top:30px;line-height:1.35">
        Clinical photo documentation,<br/>kept on your PC.
      </div>
      <div style="font-size:24px;font-weight:400;color:rgba(244,251,252,0.62);margin-top:44px;letter-spacing:1px">
        cliniciq.com.au
      </div>
    </div>
    <img src="data:image/svg+xml;base64,${Buffer.from(glyphSVG({ color: '#F4FBFC' })).toString('base64')}"
      style="position:absolute;left:1130px;top:220px;filter:drop-shadow(0 30px 60px rgba(0,20,24,0.45))" width="640" height="640" />
  </div>`;
  await render(body, { w, h, out: join(ASSETS, 'heading-hero-1920x1080.png') });
}

// ---------------------------------------------------------------------------
// 3. Listing screenshots — 1920x1080 frames from the cleared captures
// ---------------------------------------------------------------------------
const SHOTS = [
  {
    src: '01-capture2.png', crop: 57, name: 'capture',
    head: 'Capture from your phone or webcam',
    sub: 'Pair over Wi-Fi, a hotspot or Tailscale — a QR code does the pairing.',
  },
  {
    src: '02-photo-detail-result-files.png', crop: 57, name: 'photo-detail',
    head: 'Photos, results and notes — one record',
    sub: 'Pin photos to the body map and attach pathology reports with in-app PDF preview.',
  },
  {
    src: '06-photo-notes.png', crop: 0, name: 'photo-notes',
    head: 'Notes that write themselves',
    sub: 'Quick-text templates with {date}, {patient} and {bodypart} filled in — plus subpart suggestions from your own history.',
  },
  {
    src: '07-note-templates.png', crop: 0, name: 'note-templates',
    head: 'Your own quick text',
    sub: 'Per-clinician note templates with shortcuts that expand as you type — Settings → Templates.',
  },
  {
    src: '03-compare.png', crop: 57, name: 'compare',
    head: 'See change over time',
    sub: 'Side-by-side and overlay compare with shared zoom and annotation.',
  },
  {
    src: '04-patient-timeline.png', crop: 57, name: 'timeline',
    head: 'The whole story in one timeline',
    sub: 'Lesion series, review scheduling and overdue alerts on your dashboard.',
  },
  {
    src: '05-report.png', crop: 57, name: 'report',
    head: 'Case reports that never leave the PC',
    sub: 'On-device PDF reports, ready to print or send from your own email.',
  },
  {
    src: '08-licence-autorenew.png', crop: 0, name: 'licence-autorenew',
    head: 'Licences that renew themselves',
    sub: 'Subscription renewals install automatically after each payment — no key re-entry.',
  },
  {
    src: '00-login2.png', crop: 0, name: 'login',
    head: 'Built for practices',
    sub: 'Multi-user roles, consent recording and an encrypted local database.',
  },
];

for (const s of SHOTS) {
  const w = 1920, h = 1080;
  const winW = 1740;
  const imgH = Math.round((1176 - s.crop) * (winW / 2048)); // scaled content height
  const winX = (w - winW) / 2, winY = 142;
  const img = join(BUILD, s.src);
  const body = `<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;font-family:Geist;
    background:linear-gradient(160deg, #F2F7F8 0%, #E3EDEF 100%);">
    <div style="position:absolute;left:90px;top:40px;">
      <div style="display:flex;align-items:center;gap:16px">
        <img src="data:image/svg+xml;base64,${Buffer.from(glyphSVG({})).toString('base64')}" width="34" height="34" />
        <div style="font-size:38px;font-weight:600;color:${INK};letter-spacing:-0.5px">${s.head}</div>
      </div>
      <div style="font-size:22px;font-weight:400;color:${MUTED};margin-top:8px;margin-left:50px">${s.sub}</div>
    </div>
    <div style="position:absolute;left:${winX}px;top:${winY}px;width:${winW}px;height:${imgH}px;
      border-radius:14px 14px 0 0;overflow:hidden;background:#fff;
      box-shadow:0 24px 70px rgba(6,60,68,0.22), 0 2px 8px rgba(6,60,68,0.10);">
      <img src="file://${img}" style="display:block;width:${winW}px;height:${imgH}px;object-fit:cover" />
    </div>
  </div>`;
  // per-shot crop: the raw captures carry a macOS title bar — cut it off
  await render(`<style>#c{width:${2048}px;height:${1176 - s.crop}px;overflow:hidden}#c img{display:block;margin-top:-${s.crop}px}</style>
    <div id="c"><img src="file://${join(ROOT, 'guide/store-assets/screenshots', s.src)}" /></div>`,
    { w: 2048, h: 1176 - s.crop, out: img });
  await render(body, { w, h, out: join(ASSETS, 'screenshots', `listing-${s.name}-1920x1080.png`) });
}

await browser.close();
console.log('done — assets written to guide/store-assets, src-tauri/icons, src-tauri/assets');
