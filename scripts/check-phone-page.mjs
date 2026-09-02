#!/usr/bin/env node
/**
 * Visual smoke check for the phone companion page (scripts/check-phone-page.mjs).
 *
 * Extracts the real PAGE_HTML out of remote_camera.rs, serves it with a mock
 * /library manifest and placeholder photos, drives it in a phone-sized
 * Chromium, and screenshots each surface (camera, library, patient, viewer,
 * compare, light theme). Run: node scripts/check-phone-page.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/tmp/camog-phone-check';
mkdirSync(outDir, { recursive: true });

// 1. Extract the exact page the Rust shell serves.
const rust = readFileSync(join(root, 'src-tauri/src/remote_camera_page.rs'), 'utf8');
const start = rust.indexOf('const PAGE_HTML: &str = r##"');
const end = rust.indexOf('"##;', start);
if (start < 0 || end < 0) {
  console.error('FAIL  could not extract PAGE_HTML from remote_camera.rs');
  process.exit(1);
}
const page = rust.slice(start + 'const PAGE_HTML: &str = r##"'.length, end);
writeFileSync(join(outDir, 'index.html'), page);

// 2. Mock manifest + placeholder photos (1x2 JPEG stretched by CSS).
const patients = [
  { id: 'p1', name: 'Margot Whitfield', photoCount: 8, lastPhotoAt: Date.now() - 864e5 * 2, consent: 'valid', review: 'overdue', reviewDueAt: Date.now() - 864e5 * 3, dob: '12 Apr 1968', ownerName: 'Dr Sarah Chen', consentScopeLabel: 'Care team' },
  { id: 'p2', name: 'Tane Ngata', photoCount: 8, lastPhotoAt: Date.now() - 864e5 * 9, consent: 'none', review: 'due-soon', reviewDueAt: Date.now() + 864e5 * 4, dob: '3 Sep 1990', ownerName: 'Dr Sarah Chen', consentScopeLabel: null },
  { id: 'p3', name: 'Priya Ramanathan', photoCount: 12, lastPhotoAt: Date.now() - 864e5 * 40, consent: 'valid', review: 'none', reviewDueAt: null, dob: null, ownerName: 'Dr Mere Kingi', consentScopeLabel: 'Clinical use' },
  { id: 'p4', name: 'Colin Bradshaw', photoCount: 2, lastPhotoAt: Date.now() - 864e5 * 120, consent: 'expired', review: 'stale', reviewDueAt: null, dob: '30 Jan 1955', ownerName: null, consentScopeLabel: 'Care team' },
];
const spots = [
  ['left hand', 'hand', 'left'], ['right cheek', 'face', null], ['left cheek', 'face', null],
  ['forehead', 'face', null], ['back', 'back', null], ['left shin', 'leg', 'left'],
  ['right shin', 'leg', 'right'], ['chest', 'chest', null],
];
// Interleave two patients' photos so a patient's grid positions do NOT match
// their indices in the shared manifest — the viewer/compare must resolve
// photos by manifest id, never by position (multi-patient regression guard).
const photos = [];
spots.forEach(([subpart, part, lat], i) => {
  const label = (lat ? lat[0].toUpperCase() + lat.slice(1) + ' ' : '') + part[0].toUpperCase() + part.slice(1);
  photos.push({
    id: `ph${i * 2 + 1}`,
    patientId: 'p1',
    bodyPart: part,
    bodyPartLabel: label,
    laterality: lat,
    subpart,
    notes: i === 0 ? 'Baseline before treatment. Patient reports mild itching after sun exposure.' : null,
    capturedAt: Date.now() - 864e5 * (i * 3 + 1),
  });
  photos.push({
    id: `ph${i * 2 + 2}`,
    patientId: 'p2',
    bodyPart: part,
    bodyPartLabel: label,
    laterality: lat,
    subpart,
    notes: null,
    capturedAt: Date.now() - 864e5 * (i * 3 + 2),
  });
});
const manifest = { viewing: true, generatedAt: Date.now(), patients, photos };

// 1x2 white JPEG (tiny, stretched by CSS; fine for layout checks).
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFQABAQAAAAAA' +
  'AAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF', 'utf8');

// Photos the phone "picks from its library" in the send-from-library flow.
const pick1 = join(outDir, 'pick-1.jpg');
const pick2 = join(outDir, 'pick-2.jpg');
writeFileSync(pick1, jpeg);
writeFileSync(pick2, jpeg);
let photoPosts = []; // byte lengths of each POST /photo body

const server = createServer((req, res) => {
  const url = req.url;
  if (url.endsWith('/') || url.endsWith('index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  } else if (url.endsWith('/library')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest));
  } else if (url.endsWith('/photo') && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      photoPosts.push(Buffer.concat(chunks).length);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  } else if (url.includes('/img/')) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(jpeg);
  } else if (url.endsWith('/report')) {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(pdf);
  } else if (url.endsWith('/hello')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else if (url.endsWith('/manifest.webmanifest')) {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(JSON.stringify({
      name: 'Camog · Clinical Photos',
      short_name: 'Camog',
      display: 'standalone',
      icons: [{ src: 'logo.png', sizes: '256x256', type: 'image/png', purpose: 'any' }],
    }));
  } else if (url.endsWith('/logo.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(jpeg);
  } else if (url.endsWith('/review') || url.endsWith('/report-request')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!/"patientId"\s*:\s*"p1"/.test(body)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/t/abc123/`;

// 3. Drive the page in a phone-sized viewport.
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const pageC = await browser.newPage({ viewport: { width: 390, height: 844 } });
const shots = [];
const shot = async (name) => {
  const path = join(outDir, `${name}.png`);
  await pageC.screenshot({ path });
  shots.push(path);
};

await pageC.goto(base, { waitUntil: 'networkidle' });
await shot('1-camera');

// Send from library: pick two existing photos, review one at a time (like
// the desktop upload dialog), send each down the same POST path as a snap.
await pageC.setInputFiles('#pick', [pick1, pick2]);
await pageC.waitForFunction(() =>
  document.getElementById('review-title').textContent === 'Use this photo? (1 of 2)',
);
const discardLabel = await pageC.textContent('#retake');
await pageC.click('#send');
await pageC.waitForFunction(() =>
  document.getElementById('review-title').textContent === 'Use this photo? (2 of 2)',
);
await pageC.click('#send');
await pageC.waitForFunction(() => !document.getElementById('screen-sent').hidden);
const sentLabel = await pageC.textContent('#another');
await shot('1b-send-library');

await pageC.click('#tab-lib');
await pageC.waitForTimeout(300);
await shot('2-library');

await pageC.fill('#search', 'margot');
await pageC.waitForTimeout(200);
await shot('3-library-search');

await pageC.fill('#search', '');
await pageC.click('.patient-row:first-child');
await pageC.waitForTimeout(400);
await shot('4-patient-grid');
// Desktop-parity detail lines under the photo count.
const patientDetail = await pageC.textContent('#patient-detail');

// Mark reviewed: mock accepts p1; the phone should confirm and refetch.
await pageC.click('#review-btn');
await pageC.waitForTimeout(600);
const reviewStatus = await pageC.textContent('#patient-status');

// Body-map overlays on the grid thumbnails (bottom-right of each thumb).
const gridFigs = await pageC.evaluate(
  () => document.querySelectorAll('#grid .cell-fig').length,
);
const gridHighlighted = await pageC.evaluate(
  () => document.querySelectorAll('#grid .cell-fig [data-part].hl').length,
);

// Compare: opens straight away (like the desktop dialog), pickers pre-seeded
// with the two most recent photos; side/overlay modes; shared zoom.
await pageC.click('#compare-btn');
await pageC.waitForTimeout(400);
await shot('5-compare-side');
const compareVisible = await pageC.isVisible('#screen-compare');
const pickersSeeded = await pageC.evaluate(() => {
  const l = document.getElementById('cmp-left');
  const r = document.getElementById('cmp-right');
  return l.options.length === 8 && r.options.length === 8 &&
    l.value === '0' && r.value === '2';
});
await pageC.click('#zoom-in');
await pageC.click('#zoom-in');
const zoomPct = await pageC.textContent('#zoom-pct');
await pageC.click('#mode-overlay');
await pageC.waitForTimeout(300);
const overlayOn = await pageC.evaluate(() =>
  !document.getElementById('cmp-opacity-row').hidden &&
  !!document.querySelector('#cmp-frame .cmp-overlay'),
);
await shot('6-compare-overlay');
await pageC.click('#compare-back');
await pageC.waitForTimeout(200);

// Viewer: no body-map sheet any more (it moved onto the thumbnails), blur works.
await pageC.click('#grid button:first-child');
await pageC.waitForTimeout(400);
const viewerFigs = await pageC.evaluate(
  () => document.querySelectorAll('#viewer-meta .bodyfig').length,
);
await shot('7-viewer');
await pageC.click('#blur-btn');
await pageC.waitForTimeout(250);
const blurred = await pageC.evaluate(() =>
  document.getElementById('stage').classList.contains('blurred'),
);
await shot('8-viewer-blurred');

// Multi-patient regression guard: tap the OLDEST photo (last grid cell). Its
// position in the per-patient grid (7) differs from its index in the shared
// manifest (14), so the viewer must resolve by manifest id — the tapped
// photo (ph15), not whatever sits at position 14 of the filtered list.
await pageC.click('#viewer-back');
await pageC.waitForTimeout(200);
await pageC.click('#grid button:last-child');
await pageC.waitForTimeout(400);
const lastSrc = await pageC.evaluate(() =>
  document.getElementById('viewer-img').getAttribute('src'),
);
const lastCount = await pageC.textContent('#viewer-count');
await shot('8b-viewer-oldest');

// Photos tab (desktop Photos-page parity): every patient's photos newest
// first, searchable, patient-name chip on each cell, viewer titled with the
// patient's name.
await pageC.click('#viewer-back');
await pageC.waitForTimeout(200);
await pageC.click('#tab-all');
await pageC.waitForTimeout(400);
await shot('8c-photos');
const allCells = await pageC.evaluate(() => document.querySelectorAll('#all-grid button').length);
const allChips = await pageC.evaluate(() => document.querySelectorAll('#all-grid .cell-name').length);
const allFigs = await pageC.evaluate(() => document.querySelectorAll('#all-grid .cell-fig').length);
await pageC.fill('#all-search', 'margot');
await pageC.waitForTimeout(200);
const filteredCells = await pageC.evaluate(() => document.querySelectorAll('#all-grid button').length);
await pageC.fill('#all-search', '');
await pageC.click('#all-grid button:first-child');
await pageC.waitForTimeout(400);
const allViewerTitle = await pageC.textContent('#viewer-title');
const allViewerCount = await pageC.textContent('#viewer-count');
await shot('8d-photos-viewer');

// Light theme is the default on a fresh phone (closing the photos viewer
// returns to the Photos tab); the toggle flips to dark and back.
await pageC.click('#viewer-back');
await pageC.waitForTimeout(200);
const lightDefault = await pageC.evaluate(() => document.body.classList.contains('light'));
await pageC.click('#theme');
await pageC.waitForTimeout(200);
const darkOn = await pageC.evaluate(() => !document.body.classList.contains('light'));
await pageC.click('#theme');
await pageC.waitForTimeout(200);
const backToLight = await pageC.evaluate(() => document.body.classList.contains('light'));
await pageC.click('#tab-cam');
await pageC.waitForTimeout(200);
await shot('9-light-theme');

// Home-screen app (PWA): the manifest route serves, and the page links it
// plus the apple-touch-icon so both platforms can pin Camog with its logo.
const manifestOk = await pageC.evaluate(async () => (await fetch('manifest.webmanifest')).ok);
const pwaLinked = page.includes('rel="manifest" href="manifest.webmanifest"') &&
  page.includes('rel="apple-touch-icon" href="logo.png"');

// Case report: after the theme check we are back on the patient screen
// (closing the viewer keeps the patient open), so request it directly.
await pageC.click('#tab-lib');
await pageC.waitForTimeout(200);
await pageC.click('#report-btn');
await pageC.waitForTimeout(2500);
const reportStatus = await pageC.textContent('#patient-status');

// Home-screen app: in standalone mode a PWA cannot open a new tab (the old
// target="_blank" delivery silently did nothing there), so the page must
// detect standalone and hand the PDF to the platform — a real download here.
const standalonePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await standalonePage.addInitScript(() => {
  const orig = window.matchMedia;
  window.matchMedia = function (query) {
    const m = orig.call(window, query);
    if (String(query).includes('display-mode: standalone')) {
      return {
        matches: true, media: query, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false; },
      };
    }
    return m;
  };
});
await standalonePage.goto(base, { waitUntil: 'networkidle' });
await standalonePage.click('#tab-lib');
await standalonePage.waitForTimeout(200);
await standalonePage.click('.patient-row:first-child');
await standalonePage.waitForTimeout(300);
const downloadPromise = standalonePage.waitForEvent('download', { timeout: 10000 });
await standalonePage.click('#report-btn');
const reportDownload = await downloadPromise;
const standaloneReportStatus = await standalonePage.textContent('#patient-status');
await standalonePage.close();

await browser.close();
server.close();

// 4. Behavioural assertions.
const checks = [
  ['library tab in page source', page.includes('id="tab-lib"')],
  ['search + patient rows + viewer present', ['id="search"', 'patient-row', 'id="stage"'].every((s) => page.includes(s))],
  ['review request accepted + confirmed', reviewStatus.includes('Marked as reviewed')],
  ['grid thumbnails carry body-map overlays', gridFigs === 8 && gridHighlighted > 0],
  ['compare opens like the desktop dialog (pickers pre-seeded)', compareVisible === true && pickersSeeded === true],
  ['shared zoom applies to the compare viewport', zoomPct === '156%'],
  ['overlay mode shows the opacity control', overlayOn === true],
  ['viewer opens the tapped photo, not the manifest-position one', lastSrc === 'img/ph15.jpg' && lastCount === '8 of 8'],
  ['viewer metadata no longer carries the diagram', viewerFigs === 0],
  ['blur toggle engages', blurred === true],
  ['light theme is the default and toggles to dark and back', lightDefault === true && darkOn === true && backToLight === true],
  ['report prepared + confirmed', reportStatus.includes('Report ready')],
  ['send-from-library reviews each picked photo', discardLabel === 'Discard' && sentLabel === 'Send more from library'],
  ['picked photos POST down the capture pipeline', photoPosts.length === 2 && photoPosts.every((n) => n > 0)],
  ['patient detail shows DOB, clinician and consent scope',
    ['DOB 12 Apr 1968', 'Dr Sarah Chen', 'Consent: Care team'].every((s) => patientDetail.includes(s))],
  ['photos tab lists every photo with patient names', allCells === 16 && allChips === 16 && allFigs > 0],
  ['photos search filters by patient', filteredCells === 8],
  ['photos viewer shows the patient name', allViewerTitle.startsWith('Margot Whitfield') && allViewerCount === '1 of 16'],
  ['home-screen app: manifest serves and PWA links are in the page', manifestOk === true && pwaLinked === true],
  ['standalone report downloads instead of opening a blocked tab',
    reportDownload.suggestedFilename() === 'camog-case-report.pdf' && standaloneReportStatus.includes('Report ready')],
];
let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
console.log(`\nScreenshots in ${outDir}:`);
for (const s of shots) console.log(`  ${s}`);
process.exit(failures ? 1 : 0);
