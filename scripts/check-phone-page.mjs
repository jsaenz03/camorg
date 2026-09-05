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
// The link page (served to every rejected request): restore + scan QR.
const linkStart = rust.indexOf('const LINK_HTML: &str = r##"');
const linkEnd = rust.indexOf('"##;', linkStart);
if (linkStart < 0 || linkEnd < 0) {
  console.error('FAIL  could not extract LINK_HTML from remote_camera.rs');
  process.exit(1);
}
const linkPageHtml = rust.slice(linkStart + 'const LINK_HTML: &str = r##"'.length, linkEnd);

// 2. Mock manifest + placeholder photos (1x2 JPEG stretched by CSS).
// Array order = last capture, newest first — what the desktop list ships and
// what the phone's Recent sort reproduces.
const patients = [
  { id: 'p1', name: 'Margot Whitfield', photoCount: 8, lastPhotoAt: Date.now() - 864e5 * 2, consent: 'valid', review: 'overdue', reviewOwn: 'overdue', reviewDueAt: Date.now() - 864e5 * 3, dob: '12 Apr 1968', ownerName: 'Dr Sarah Chen', consentScopeLabel: 'Care team' },
  // review escalated to overdue by ph2 (photo-level), like the real builder;
  // the patient's own schedule (+4d) is merely due soon — but ph2's own due
  // date is 5 days OVERDUE, so review sorting must lead with Tane.
  { id: 'p2', name: 'Tane Ngata', photoCount: 8, lastPhotoAt: Date.now() - 864e5 * 9, consent: 'none', review: 'overdue', reviewOwn: 'due-soon', reviewDueAt: Date.now() + 864e5 * 4, dob: '3 Sep 1990', ownerName: 'Dr Sarah Chen', consentScopeLabel: null },
  // No photo needs review; the next one is months out — the card must still
  // name the date (the desktop badge never hides a scheduled review).
  { id: 'p5', name: 'Hana Keepa', photoCount: 1, lastPhotoAt: Date.now() - 864e5 * 30, consent: 'valid', review: 'scheduled', reviewOwn: 'scheduled', reviewDueAt: Date.now() + 864e5 * 90, dob: '7 Jul 1983', ownerName: 'Dr Mere Kingi', consentScopeLabel: 'Clinical use' },
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
// Review fields drive the phone's banners: ph1 overdue, ph3 due-soon, ph2
// overdue, everything else recently reviewed.
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
    review: i === 0 ? 'overdue' : i === 1 ? 'due-soon' : 'none',
    reviewDueAt: i === 0 ? Date.now() - 864e5 * 2 : i === 1 ? Date.now() + 864e5 * 3 : null,
    lastReviewedAt: i > 1 ? Date.now() - 864e5 * 10 : null,
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
    review: i === 0 ? 'overdue' : 'none',
    reviewDueAt: i === 0 ? Date.now() - 864e5 * 5 : null,
    lastReviewedAt: i > 0 ? Date.now() - 864e5 * 10 : null,
  });
});
// One far-out scheduled photo for p5 (see the patients array above).
photos.push({
  id: 'ph17',
  patientId: 'p5',
  bodyPart: 'chest',
  bodyPartLabel: 'Chest',
  laterality: null,
  subpart: 'follow-up',
  notes: null,
  capturedAt: Date.now() - 864e5 * 30,
  review: 'scheduled',
  reviewDueAt: Date.now() + 864e5 * 90,
  lastReviewedAt: Date.now() - 864e5 * 30,
});
// A second reviewable p1 photo (due soon, oldest capture) so all three
// review-offer paths — no photo, snap, send-from-library — are driven.
photos.push({
  id: 'ph18',
  patientId: 'p1',
  bodyPart: 'chest',
  bodyPartLabel: 'Chest',
  laterality: null,
  subpart: 'follow-up two',
  notes: null,
  capturedAt: Date.now() - 864e5 * 25,
  review: 'due-soon',
  reviewDueAt: Date.now() + 864e5 * 2,
  lastReviewedAt: null,
});

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
let photoPosts = []; // { bytes, patientId } of each POST /photo body

// Library change signalling, mirroring the Rust shell's library-wait: held
// long-polls wake when the desktop "publishes", and a sticky dirty flag
// means a change landing between holds is answered on the next open instead
// of being missed. The cap stands in for the real shell's 25s hold.
let libraryDirty = false;
let libraryWaiters = [];
function notifyLibraryChanged() {
  libraryDirty = true;
  const waiters = libraryWaiters;
  libraryWaiters = [];
  waiters.forEach((wake) => wake());
}
const LIBRARY_WAIT_CAP_MS = 1200;

const server = createServer((req, res) => {
  const url = req.url;
  if (url.endsWith('/') || url.endsWith('index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  } else if (url.endsWith('/library')) {
    // Built per request: a photo-review POST mutates the photo in place and
    // the phone's refetch must see the flipped review state.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ viewing: true, generatedAt: Date.now(), patients, photos }));
  } else if (url.endsWith('/photo') && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      photoPosts.push({
        bytes: Buffer.concat(chunks).length,
        patientId: req.headers['x-patient-id'] ?? null,
      });
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
  } else if (url.endsWith('/link-code')) {
    // Tells the paired page its pairing code (drives self-heal + restore).
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: '0123456789abcdef' }));
  } else if (url.endsWith('/library-wait')) {
    // Long-poll like the real shell: answer true when a change is pending
    // (sticky) or a notify releases the hold; false on cap.
    res.on('error', () => {});
    if (libraryDirty) {
      libraryDirty = false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"changed":true}');
    } else {
      const wake = () => {
        libraryDirty = false;
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"changed":true}');
        } catch { /* phone went away */ }
      };
      libraryWaiters.push(wake);
      setTimeout(() => {
        libraryWaiters = libraryWaiters.filter((w) => w !== wake);
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"changed":false}');
        } catch { /* phone went away */ }
      }, LIBRARY_WAIT_CAP_MS);
    }
  } else if (url.endsWith('/logo.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(jpeg);
  } else if (url.endsWith('/photo-review')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const photo = photos.find((p) => p.id === parsed.photoId);
      if (!photo) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      // Stamp the review exactly like the desktop service would.
      photo.review = 'none';
      photo.reviewDueAt = null;
      photo.lastReviewedAt = Date.now();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  } else if (url.endsWith('/report-request')) {
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
  } else if (req.method === 'GET') {
    // Mirror the real server: every rejected GET gets the link page — with
    // the 404 status, which is how the page tells "credential dead" from
    // "server gone".
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(linkPageHtml);
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

// 'load', not 'networkidle': the page holds a library-wait long-poll open
// from connect onwards, so the network never goes idle while it runs.
await pageC.goto(base, { waitUntil: 'load' });
// Fixed chrome must not be in the paint during the splash: WebKit
// composites fixed elements at the settling cold-start offset, so the tab
// bar and theme button mount only when the splash hands over.
const chromeHiddenDuringBoot = await pageC.evaluate(() =>
  document.getElementById('theme').hidden && document.getElementById('tabbar').hidden,
);
// The page keeps its pairing code (fed by /link-code) so a dead session can
// self-heal through the saved /t/<code>/ URL and the link page can restore.
const savedCode = await pageC.evaluate(() => localStorage.getItem('camog-link-code'));

// Boot splash: the breathing-logo notice owns the first paint and hands
// over in one pass once hello + library answer; the tab bar must already
// sit at the bottom of the viewport when it does (cold-start regression
// guard — it used to first-paint mid-screen until a manual refresh).
const bootGone = await pageC
  .waitForFunction(() => !document.getElementById('boot'), undefined, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
const tabbarAtBottom = await pageC.evaluate(() => {
  const bar = document.getElementById('tabbar');
  if (!bar || bar.hidden) return false;
  const r = bar.getBoundingClientRect();
  return r.bottom >= window.innerHeight - 2 && r.top > window.innerHeight / 2;
});
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
// Patients sort: the list OPENS on Review due (the new default — the most
// urgent patient leads, Tane's overdue photo ahead of Margot's own overdue
// schedule); Name re-orders A–Z; Recent reproduces the manifest order; the
// Review order re-selects cleanly and the arrow flips it; back to Recent
// restores the manifest order for the card assertions below.
const rowsOrder = () => pageC.$$eval(
  '#patients .patient-row .name',
  (els) => els.map((e) => e.textContent),
);
const REVIEW_ORDER = ['Tane Ngata', 'Margot Whitfield', 'Hana Keepa', 'Colin Bradshaw', 'Priya Ramanathan'];
const sortDefault = await pageC.inputValue('#sort');
const orderDefault = await rowsOrder();
await shot('2b-library-sort-default');
await pageC.selectOption('#sort', 'name');
await pageC.waitForTimeout(150);
const orderName = await rowsOrder();
await shot('2b-library-sort-name');
await pageC.selectOption('#sort', 'recent');
await pageC.waitForTimeout(150);
const orderRecent = await rowsOrder();
await pageC.selectOption('#sort', 'review');
await pageC.waitForTimeout(150);
const orderReviewAsc = await rowsOrder();
await pageC.click('#sort-dir');
await pageC.waitForTimeout(150);
const orderReviewDesc = await rowsOrder();
await shot('2b-library-sort-review');
await pageC.selectOption('#sort', 'recent');
await pageC.waitForTimeout(150);
const orderRestored = await rowsOrder();
// The sort control itself must render on a narrow phone (it used to be
// squeezed out of the topbar on load).
const sortVisible = await pageC.evaluate(() => {
  const r = document.getElementById('sort').getBoundingClientRect();
  return r.width > 40 && r.height > 20 && r.right <= window.innerWidth && r.top >= 0;
});

// Bilateral sync: a desktop-side change (the review-date toggle the phone
// used to miss entirely) republishes the manifest and releases the held
// long-poll — the phone must show it with no refresh, the same way snaps
// arrive on the desktop the moment they are taken.
const priya = patients.find((p) => p.id === 'p3');
priya.name = 'Priya Natarajan';
priya.review = 'due-soon';
priya.reviewDueAt = Date.now() + 864e5 * 5;
notifyLibraryChanged();
const syncRow = await pageC
  .waitForFunction(
    () => Array.from(document.querySelectorAll('#patients .patient-row .name'))
      .some((el) => el.textContent === 'Priya Natarajan'),
    undefined,
    { timeout: 5000 },
  )
  .then(() => pageC.evaluate(() =>
    Array.from(document.querySelectorAll('#patients .patient-row'))
      .find((el) => el.textContent.includes('Priya Natarajan'))
      .textContent))
  .catch(() => 'SYNC-FAIL');
await shot('2c-library-live-sync');
// Restore so every later section asserts against the original manifest.
priya.name = 'Priya Ramanathan';
priya.review = 'none';
priya.reviewDueAt = null;
notifyLibraryChanged();
await pageC.waitForFunction(
  () => Array.from(document.querySelectorAll('#patients .patient-row .name'))
    .every((el) => el.textContent !== 'Priya Natarajan'),
  undefined,
  { timeout: 5000 },
).catch(() => {});
// Due-review banner (desktop review-badge parity): the mock library has 3
// photos due (ph1 + ph2 overdue, ph3 due-soon) with ph2's date earliest.
const libDue = await pageC.textContent('#lib-due');
const libDueClass = await pageC.evaluate(() => document.getElementById('lib-due').className);
// Patient cards mirror the desktop badge pair: the patient's own review line
// names its date (even "was due"), and the photo-level line counts that
// patient's photos — including the quiet "Next photo review on" for a date
// months out.
const p1Row = await pageC.textContent('.patient-row:first-child');
const p2Row = await pageC.textContent('.patient-row:nth-child(2)');
const p5Row = await pageC.evaluate(() =>
  Array.from(document.querySelectorAll('#patients .patient-row'))
    .find((el) => el.textContent.includes('Hana Keepa'))
    .textContent);
// Flags render as pills; the far-out date's pill stays neutral (no colour).
const flagPills = await pageC.evaluate(() => {
  const style = (sel) => {
    const el = document.querySelector(sel);
    const s = getComputedStyle(el);
    return { radius: s.borderRadius, bg: s.backgroundColor };
  };
  return {
    quiet: style('.patient-row:last-child .flag-quiet'),
    overdue: style('.patient-row:first-child .flag-overdue'),
  };
});

await pageC.fill('#search', 'margot');
await pageC.waitForTimeout(200);
await shot('3-library-search');

await pageC.fill('#search', '');
await pageC.click('.patient-row:first-child');
await pageC.waitForTimeout(400);
await shot('4-patient-grid');
// Desktop-parity detail lines under the photo count.
const patientDetail = await pageC.textContent('#patient-detail');

// Photo review, desktop-dialog parity: photos needing review carry a corner
// dot in the grid, the viewer shows the status banner, and Mark reviewed asks
// whether to snap the follow-up. The newest p1 photo (first grid cell) is
// overdue; the second is due-soon.
const gridDots = await pageC.evaluate(
  () => document.querySelectorAll('#grid .cell-review').length,
);
await pageC.click('#grid button:first-child');
await pageC.waitForTimeout(400);
const viewerFlag = await pageC.textContent('#viewer-flag');
await shot('4b-viewer-review');

// "No photo needed": the review is stamped on the computer, the manifest
// refetch flips the banner, and the doctor stays on the photo.
await pageC.click('#viewer-review-btn');
await pageC.waitForTimeout(200);
const offerShown = await pageC.isVisible('#viewer-offer');
await pageC.click('#photo-review-plain');
await pageC.waitForFunction(() => {
  const last = document.getElementById('viewer-last');
  return last && !last.hidden && last.textContent.startsWith('Reviewed');
});
const flagGone = await pageC.evaluate(() => document.getElementById('viewer-flag').hidden);
await pageC.click('#viewer-back');
await pageC.waitForTimeout(200);

// "Snap photo": the review is stamped, the camera input opens INSIDE the
// tap (no trip to the camera start page first), and the taken photo lands
// on the review screen with the series-link note; sending drops the note
// back to the default so the camera reads fresh again.
await pageC.click('#grid button:nth-child(2)');
await pageC.waitForTimeout(400);
await pageC.click('#viewer-review-btn');
const snapChooserPromise = pageC.waitForEvent('filechooser');
await pageC.click('#photo-review-snap');
const snapChooser = await snapChooserPromise;
await snapChooser.setFiles(pick1);
await pageC.waitForFunction(() => !document.getElementById('screen-review').hidden);
await pageC.waitForFunction(() =>
  document.getElementById('conn').textContent ===
  'Review marked. Send this photo to link it with the original.',
);
const snapConn = await pageC.textContent('#conn');
const snapViewerClosed = await pageC.evaluate(() => document.getElementById('screen-viewer').hidden);
await shot('4c-review-snap');
await pageC.click('#send');
await pageC.waitForFunction(() => !document.getElementById('screen-sent').hidden);
const snapSentHint = await pageC.textContent('#sent-hint');
await pageC.click('#another');
const snapConnAfterSend = await pageC.textContent('#conn');
await shot('4c2-followup-sent');

// Take photo on the patient screen: opens the camera directly and
// addresses the snap to this patient — the POST carries X-Patient-Id, the
// chip names the patient and survives across sends until cleared.
await pageC.click('#tab-lib');
await pageC.waitForTimeout(400);
const patientChooserPromise = pageC.waitForEvent('filechooser');
await pageC.click('#patient-capture');
const patientChooser = await patientChooserPromise;
const chipShown = await pageC.evaluate(() =>
  !document.getElementById('capture-for').hidden && document.getElementById('screen-cam').hidden,
);
const chipText = await pageC.textContent('#capture-for-name');
await patientChooser.setFiles(pick2);
await pageC.waitForFunction(() => !document.getElementById('screen-review').hidden);
await pageC.click('#send');
await pageC.waitForFunction(() => !document.getElementById('screen-sent').hidden);
const chipAfterSend = await pageC.evaluate(() => !document.getElementById('capture-for').hidden);
await pageC.click('#another'); // start screen again — the chip rides along
await pageC.click('#capture-for-clear');
const chipCleared = await pageC.evaluate(() => document.getElementById('capture-for').hidden);
await shot('4d-patient-capture');
// Back to the patient for the next section.
await pageC.click('#tab-lib');
await pageC.waitForTimeout(400);

// Send from library on the patient screen: the same multi-pick review flow
// as the camera page, with every POST stamped for this patient.
const patientPickPromise = pageC.waitForEvent('filechooser');
await pageC.click('#patient-pick');
const patientPickChooser = await patientPickPromise;
await patientPickChooser.setFiles([pick1, pick2]);
await pageC.waitForFunction(() =>
  document.getElementById('review-title').textContent === 'Use this photo? (1 of 2)',
);
const pickChipShown = await pageC.evaluate(() => !document.getElementById('capture-for').hidden);
await pageC.click('#send');
await pageC.waitForFunction(() =>
  document.getElementById('review-title').textContent === 'Use this photo? (2 of 2)',
);
await pageC.click('#send');
await pageC.waitForFunction(() => !document.getElementById('screen-sent').hidden);
await pageC.click('#another');
await pageC.click('#capture-for-clear');
const pickChipCleared = await pageC.evaluate(() => document.getElementById('capture-for').hidden);
await shot('4e-patient-pick');
// Back to the patient for the next section.
await pageC.click('#tab-lib');
await pageC.waitForTimeout(400);

// Review follow-up from the phone's library: the offer's second choice
// arms the same series link but opens the library picker instead of the
// camera; the picked photo flows down the normal review-and-send path.
await pageC.click('#grid button:last-child');
await pageC.waitForTimeout(400);
const libOfferFlag = await pageC.textContent('#viewer-flag');
await pageC.click('#viewer-review-btn');
// First attempt: open the picker, then dismiss it without choosing. The
// review still stamps and the banner flips in place, but the three-choice
// offer must stay up with live buttons — no "Mark reviewed" round-trip.
const dismissedPromise = pageC.waitForEvent('filechooser');
await pageC.click('#photo-review-library');
const dismissed = await dismissedPromise;
await dismissed.setFiles([]);
await pageC.waitForFunction(() =>
  document.getElementById('conn').textContent ===
  'Review marked. Send this photo to link it with the original.',
);
const offerKept = await pageC.evaluate(() =>
  !document.getElementById('viewer-offer').hidden &&
  !document.getElementById('photo-review-library').disabled &&
  document.getElementById('viewer-last').textContent.startsWith('Reviewed'),
);
await shot('4f-review-library-dismissed');
// Second attempt (straight from the still-open offer) goes end to end.
const libOfferPromise = pageC.waitForEvent('filechooser');
await pageC.click('#photo-review-library');
const libOfferChooser = await libOfferPromise;
await libOfferChooser.setFiles([pick1]);
await pageC.waitForFunction(() => !document.getElementById('screen-review').hidden);
await pageC.waitForFunction(() =>
  document.getElementById('conn').textContent ===
  'Review marked. Send this photo to link it with the original.',
);
await pageC.click('#send');
await pageC.waitForFunction(() => !document.getElementById('screen-sent').hidden);
const libOfferSentHint = await pageC.textContent('#sent-hint');
await pageC.click('#another');
await shot('4f-review-library');
// Back to the patient for the compare/viewer sections below.
await pageC.click('#tab-lib');
await pageC.waitForTimeout(400);
// Both just-reviewed photos (overdue + due-soon) drop off the banner: only
// ph2's overdue review remains.
const libDueAfter = await pageC.textContent('#lib-due');

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
// Compare chrome follows the theme (light here), photo panes stay black.
const compareTheme = await pageC.evaluate(() => ({
  surface: getComputedStyle(document.getElementById('screen-compare')).backgroundColor,
  pane: getComputedStyle(document.querySelector('.cmp-pane')).backgroundColor,
  picker: getComputedStyle(document.getElementById('cmp-left')).backgroundColor,
  label: getComputedStyle(document.querySelector('.cmp-pickers label')).color,
}));
const pickersSeeded = await pageC.evaluate(() => {
  const l = document.getElementById('cmp-left');
  const r = document.getElementById('cmp-right');
  return l.options.length === 9 && r.options.length === 9 &&
    l.value === '0' && r.value === '2';
});
await pageC.click('#zoom-in');
await pageC.click('#zoom-in');
const zoomPct = await pageC.textContent('#zoom-pct');
// Anchor toggle (desktop parity): linked zoom moves BOTH panes; switching to
// free zooms only the active pane; re-anchoring moves both again, each from
// its own zoom; choosing another photo resets the viewport to default.
const paneTransforms = () => pageC.evaluate(() =>
  Array.from(document.querySelectorAll('#cmp-frame img')).map((img) => img.style.transform));
const linkedTransforms = await paneTransforms();
const anchorOnOpen = await pageC.getAttribute('#cmp-anchor', 'aria-pressed');
await pageC.click('#cmp-anchor'); // -> Free
const anchorReleased = await pageC.getAttribute('#cmp-anchor', 'aria-pressed');
const anchorLabelFree = await pageC.textContent('#cmp-anchor-label');
await pageC.click('#zoom-in'); // active pane only (nothing touched yet -> left)
const freeTransforms = await paneTransforms();
await pageC.click('#cmp-anchor'); // -> Linked again
await pageC.click('#zoom-in'); // both panes move again, each from its own zoom
const reanchoredTransforms = await paneTransforms();
const reanchoredPct = await pageC.textContent('#zoom-pct');
await pageC.selectOption('#cmp-right', { index: 3 }); // pick change resets viewport
await pageC.waitForTimeout(200);
const resetTransforms = await paneTransforms();
const resetPct = await pageC.textContent('#zoom-pct');
await pageC.click('#mode-overlay');
await pageC.waitForTimeout(300);
const overlayOn = await pageC.evaluate(() =>
  !document.getElementById('cmp-opacity-row').hidden &&
  !!document.querySelector('#cmp-frame .cmp-overlay'),
);
await shot('6-compare-overlay');
await pageC.click('#compare-back');
await pageC.waitForTimeout(200);

// Compare tab (desktop Compare-page parity): its own tab in the bar, opening
// on two DIFFERENT patients — the first with photos, then the next different
// one — with the photo pickers relabelled to the patient names, pane chips
// naming the patient, a body-part filter narrowing both pools at once, and
// the tab bar kept visible (it is a tab, not a dialog).
await pageC.click('#tab-cmp');
await pageC.waitForTimeout(400);
await shot('5b-compare-tab');
const cmpTab = await pageC.evaluate(() => {
  const sel = (id) => document.getElementById(id);
  return {
    surfaceOpen: !sel('screen-compare').hidden,
    tabSelected: sel('tab-cmp').getAttribute('aria-selected'),
    barVisible: !sel('tabbar').hidden,
    backHidden: sel('compare-back').hidden,
    patientRowShown: !sel('cmp-patients').hidden,
    leftPid: sel('cmp-patient-left').value,
    rightPid: sel('cmp-patient-right').value,
    leftLabel: sel('cmp-left-label').textContent,
    rightLabel: sel('cmp-right-label').textContent,
    partOptions: sel('cmp-part').options.length,
    leftOpts: sel('cmp-left').options.length,
    rightOpts: sel('cmp-right').options.length,
    chips: Array.from(document.querySelectorAll('#cmp-frame .chip')).map((c) => c.textContent),
  };
});
// Body-part filter: "Chest" exists once per patient (p1's ph18, p2's ph16),
// so both pools must narrow to a single photo while the chips keep naming
// the patients.
await pageC.selectOption('#cmp-part', { label: 'Chest' });
await pageC.waitForTimeout(300);
await shot('5c-compare-tab-chest');
const cmpChest = await pageC.evaluate(() => ({
  leftOpts: document.getElementById('cmp-left').options.length,
  rightOpts: document.getElementById('cmp-right').options.length,
  chips: Array.from(document.querySelectorAll('#cmp-frame .chip')).map((c) => c.textContent),
}));
// The same patient on both sides is the before/after workflow (the desktop
// page's single-patient degrade); picks re-seed newest-first, right stepped
// aside from the left.
await pageC.selectOption('#cmp-patient-right', 'p1');
await pageC.waitForTimeout(300);
const cmpSamePatient = await pageC.evaluate(() => ({
  leftOpts: document.getElementById('cmp-left').options.length,
  rightOpts: document.getElementById('cmp-right').options.length,
  rightLabel: document.getElementById('cmp-right-label').textContent,
  leftId: document.getElementById('cmp-left').value,
  rightId: document.getElementById('cmp-right').value,
  partValue: document.getElementById('cmp-part').value,
}));
// Tab semantics: another tab closes the surface, coming back restores it
// with the patients the tab was left on.
await pageC.click('#tab-all');
await pageC.waitForTimeout(200);
const compareHiddenOnOtherTab = await pageC.evaluate(() =>
  document.getElementById('screen-compare').hidden);
await pageC.click('#tab-cmp');
await pageC.waitForTimeout(200);
const compareTabRestored = await pageC.evaluate(() => ({
  open: !document.getElementById('screen-compare').hidden,
  leftPid: document.getElementById('cmp-patient-left').value,
  rightPid: document.getElementById('cmp-patient-right').value,
}));
await pageC.click('#tab-lib');
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

// Multi-patient regression guard: tap the OLDEST photo (last grid cell).
// Its position in the per-patient grid (8) differs from its index in the
// shared manifest (17), so the viewer must resolve by manifest id — the
// tapped photo (ph18), not whatever sits at position 17 of the filtered
// list.
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
// Photos tab carries the same banner, and the scroll shell holds: screens
// scroll internally while the fixed tab bar stays put (no page rubber band).
const allDue = await pageC.textContent('#all-due');
const shell = await pageC.evaluate(() => {
  const barTop = () => document.getElementById('tabbar').getBoundingClientRect().top;
  const before = barTop();
  const all = document.getElementById('screen-all');
  all.scrollTop = 99999;
  return {
    bodyOverflow: getComputedStyle(document.body).overflow,
    screenScrolls: all.scrollTop > 0,
    pageOverscroll: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
    barStable: barTop() === before,
  };
});
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
const darkMeta = await pageC.evaluate(() =>
  document.getElementById('meta-theme').getAttribute('content'));
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
await standalonePage.goto(base, { waitUntil: 'load' });
await standalonePage.waitForFunction(
  () => !document.getElementById('boot'),
  undefined,
  { timeout: 5000 },
);
await standalonePage.click('#tab-lib');
await standalonePage.waitForTimeout(200);
// The report mock only serves patient p1 — pick Margot by name (the
// default Review sort no longer puts her first).
await standalonePage.click('.patient-row:has-text("Margot Whitfield")');
await standalonePage.waitForTimeout(300);
const downloadPromise = standalonePage.waitForEvent('download', { timeout: 10000 });
await standalonePage.click('#report-btn');
const reportDownload = await downloadPromise;
const standaloneReportStatus = await standalonePage.textContent('#patient-status');
await standalonePage.close();

// Link page (what a rejected phone lands on): with a saved code it
// auto-restores once and lands connected on the companion page; with the
// one-shot flag set it stays put behind a manual Restore button; the scan
// button tracks BarcodeDetector support. Opened on an unknown path here —
// the mock serves the link page there, like the real server does.
const autoHeal = await browser.newPage({ viewport: { width: 390, height: 844 } });
await autoHeal.addInitScript(() => {
  localStorage.setItem('camog-link-code', '0123456789abcdef');
});
await autoHeal.goto(base + 'link', { waitUntil: 'commit' });
await autoHeal.waitForSelector('#conn', { timeout: 8000 });
const healedPath = new URL(autoHeal.url()).pathname;
const healedCode = await autoHeal.evaluate(() => localStorage.getItem('camog-link-code'));
await autoHeal.close();

const manualLink = await browser.newPage({ viewport: { width: 390, height: 844 } });
await manualLink.addInitScript(() => {
  localStorage.setItem('camog-link-code', '0123456789abcdef');
  sessionStorage.setItem('camog-link-tried', '1');
});
await manualLink.goto(base + 'link', { waitUntil: 'load' });
const restoreVisible = await manualLink.isVisible('#restore');
const scanTracksSupport = await manualLink.evaluate(() =>
  document.getElementById('scan').hidden === !('BarcodeDetector' in window));
await manualLink.click('#restore');
await manualLink.waitForSelector('#conn', { timeout: 8000 });
await manualLink.close();

await browser.close();
server.close();

// 4. Behavioural assertions.
const checks = [
  ['boot splash hands over once the link answers', bootGone === true],
  ['fixed chrome stays out of the paint until the splash hands over', chromeHiddenDuringBoot === true],
  ['tab bar paints at the bottom on first load', tabbarAtBottom === true],
  ['companion page remembers its pairing code', savedCode === '0123456789abcdef'],
  ['link page auto-restores the saved link onto the companion page',
    healedPath === '/t/0123456789abcdef/' && healedCode === '0123456789abcdef'],
  ['link page keeps a manual restore; scan button tracks platform support',
    restoreVisible === true && scanTracksSupport === true],
  ['library tab in page source', page.includes('id="tab-lib"')],
  ['search + patient rows + viewer present', ['id="search"', 'patient-row', 'id="stage"'].every((s) => page.includes(s))],
  ['grids flag photos that need review', gridDots === 3],
  ['due banner counts due photos and names the next date',
    libDue.startsWith('4 photos due for review on ') && libDue.includes('· 2 overdue') &&
    libDueClass === 'due-banner overdue'],
  ['patient card names its own overdue date', p1Row.includes('Review overdue · was due ')],
  ['patient card counts its due photos with the next date',
    p1Row.includes('3 photos due for review on ') && p1Row.includes('· 1 overdue')],
  ['photo escalation does not mask the patient\'s own due-soon date',
    p2Row.includes('Review due ') && p2Row.includes('1 photo due for review on ')],
  ['card shows the next review date however far out',
    p5Row.includes('Next photo review on ') && !p5Row.includes('due for review')],
  ['card flags are pills; the far-out one stays neutral',
    flagPills.quiet.radius === '999px' && flagPills.quiet.bg === 'rgba(127, 127, 127, 0.15)' &&
    flagPills.overdue.radius === '999px' && flagPills.overdue.bg === 'rgba(220, 38, 38, 0.12)'],
  ['banner updates as reviews are stamped',
    libDueAfter.startsWith('1 photo due for review') && libDueAfter.includes('· 1 overdue')],
  ['patients open on Review due with the most urgent first',
    sortDefault === 'review' && JSON.stringify(orderDefault) === JSON.stringify(REVIEW_ORDER)],
  ['sort control renders within the patients topbar', sortVisible === true],
  ['patients sort by name alphabetically',
    JSON.stringify(orderName) === JSON.stringify([...orderRecent].sort((a, b) => a.localeCompare(b)))],
  ['patients sort by review due: earliest advertised date leads (photo dues count)',
    JSON.stringify(orderReviewAsc) === JSON.stringify(
      ['Tane Ngata', 'Margot Whitfield', 'Hana Keepa', 'Colin Bradshaw', 'Priya Ramanathan'],
    )],
  ['patients review sort flips descending; undated patients stay last',
    JSON.stringify(orderReviewDesc) === JSON.stringify(
      ['Hana Keepa', 'Margot Whitfield', 'Tane Ngata', 'Colin Bradshaw', 'Priya Ramanathan'],
    )],
  ['patients sort restores the manifest order on Recent',
    JSON.stringify(orderRestored) === JSON.stringify(orderRecent)],
  ['desktop mutations reach the phone live (long-poll sync)',
    syncRow.includes('Priya Natarajan') && syncRow.includes('Review due')],
  ['photos tab carries the same banner', allDue === libDueAfter],
  ['compare chrome follows the light theme, panes stay black',
    compareTheme.surface === 'rgb(244, 244, 245)' && compareTheme.pane === 'rgb(0, 0, 0)' &&
    compareTheme.picker === 'rgb(255, 255, 255)' && compareTheme.label === 'rgb(82, 82, 91)'],
  ['screens scroll internally; the tab bar never rides the page',
    shell.bodyOverflow === 'hidden' && shell.screenScrolls &&
    shell.pageOverscroll <= 0 && shell.barStable],
  ['theme toggle updates the status-bar colour', darkMeta === '#0a0a0a'],
  ['viewer shows the review banner for an overdue photo', viewerFlag === 'Review overdue'],
  ['mark reviewed (no photo) stamps + flips the banner', offerShown === true && flagGone === true],
  ['snap follow-up opens the camera straight from the offer and stamps the review',
    snapConn === 'Review marked. Send this photo to link it with the original.' &&
    snapViewerClosed === true],
  ['sent follow-up explains the series link, then the camera reads fresh again',
    snapSentHint.includes('links it into the reviewed photo') &&
    snapConnAfterSend === 'Connected. Take the photo, review it, then send it.'],
  ['patient screen capture opens the camera for that patient and tags the POST',
    chipShown === true && chipText === 'Capturing for Margot Whitfield' &&
    chipAfterSend === true && chipCleared === true &&
    photoPosts.some((p) => p.patientId === 'p1')],
  ['patient screen send-from-library reviews + tags each pick',
    pickChipShown === true && pickChipCleared === true &&
    photoPosts.filter((p) => p.patientId === 'p1').length === 3],
  ['review follow-up can be sent from the phone library',
    libOfferFlag === 'Review due soon' &&
    libOfferSentHint.includes('links it into the reviewed photo')],
  ['dismissed library pick keeps the three-choice offer live', offerKept === true],
  ['grid thumbnails carry body-map overlays', gridFigs === 9 && gridHighlighted > 0],
  ['compare opens like the desktop dialog (pickers pre-seeded)', compareVisible === true && pickersSeeded === true],
  ['shared zoom applies to the compare viewport', zoomPct === '156%'],
  ['compare anchor toggle starts linked', anchorOnOpen === 'true' &&
    linkedTransforms.length === 2 && linkedTransforms[0] === linkedTransforms[1] &&
    linkedTransforms[0].includes('scale(1.5625)')],
  ['anchor can be released to free movement', anchorReleased === 'false' && anchorLabelFree === 'Free'],
  ['free zoom moves only the active pane', freeTransforms[0] !== freeTransforms[1]],
  ['re-anchoring moves both panes again', reanchoredPct === '244%' &&
    reanchoredTransforms[0] !== freeTransforms[0] && reanchoredTransforms[1] !== freeTransforms[1]],
  ['choosing another photo resets the viewport', resetPct === '100%' &&
    resetTransforms.length === 2 && resetTransforms.every((t) => t.includes('scale(1)'))],
  ['overlay mode shows the opacity control', overlayOn === true],
  ['compare tab opens cross-patient with the tab bar kept visible',
    cmpTab.surfaceOpen && cmpTab.tabSelected === 'true' && cmpTab.barVisible &&
    cmpTab.backHidden && cmpTab.patientRowShown &&
    cmpTab.leftPid === 'p1' && cmpTab.rightPid === 'p2' &&
    cmpTab.leftLabel === 'Reference \u2014 Margot Whitfield' &&
    cmpTab.rightLabel === 'Comparison \u2014 Tane Ngata' &&
    cmpTab.partOptions === 7],
  ['compare tab pools follow the chosen patients and chips name them',
    cmpTab.leftOpts === 9 && cmpTab.rightOpts === 8 &&
    cmpTab.chips.length === 2 &&
    cmpTab.chips[0].startsWith('Margot Whitfield') && cmpTab.chips[1].startsWith('Tane Ngata')],
  ['compare tab body-part filter narrows both sides at once',
    cmpChest.leftOpts === 2 && cmpChest.rightOpts === 1 &&
    cmpChest.chips[0].startsWith('Margot Whitfield') && cmpChest.chips[1].startsWith('Tane Ngata')],
  ['same patient on both sides is the before/after workflow',
    cmpSamePatient.leftOpts === 9 && cmpSamePatient.rightOpts === 9 &&
    cmpSamePatient.rightLabel.includes('Margot Whitfield') &&
    cmpSamePatient.partValue === 'all' &&
    cmpSamePatient.leftId === '0' && cmpSamePatient.rightId === '2'],
  ['compare tab state survives switching away and back',
    compareHiddenOnOtherTab === true && compareTabRestored.open &&
    compareTabRestored.leftPid === 'p1' && compareTabRestored.rightPid === 'p1'],
  ['viewer opens the tapped photo, not the manifest-position one', lastSrc === 'img/ph18.jpg' && lastCount === '9 of 9'],
  ['viewer metadata no longer carries the diagram', viewerFigs === 0],
  ['blur toggle engages', blurred === true],
  ['light theme is the default and toggles to dark and back', lightDefault === true && darkOn === true && backToLight === true],
  ['report prepared + confirmed', reportStatus.includes('Report ready')],
  ['send-from-library reviews each picked photo', discardLabel === 'Discard' && sentLabel === 'Send more from library'],
  ['picked photos POST down the capture pipeline',
    photoPosts.length === 7 && photoPosts.every((p) => p.bytes > 0)],
  ['patient detail shows DOB, clinician and consent scope',
    ['DOB 12 Apr 1968', 'Dr Sarah Chen', 'Consent: Care team'].every((s) => patientDetail.includes(s))],
  ['photos tab lists every photo with patient names', allCells === 18 && allChips === 18 && allFigs > 0],
  ['photos search filters by patient', filteredCells === 9],
  ['photos viewer shows the patient name', allViewerTitle.startsWith('Margot Whitfield') && allViewerCount === '1 of 18'],
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
