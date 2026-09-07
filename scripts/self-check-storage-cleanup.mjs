#!/usr/bin/env node
/**
 * Self-check for the old-photo-folder cleanup decision logic — runs the
 * REAL lib/storage/photo-file-name.ts (Node type stripping, no mirror) and
 * asserts the deletion gate: only Camog-named files, and only when the copy
 * at the new location is verified present with a matching size.
 *
 * Run: node scripts/self-check-storage-cleanup.mjs
 */

import assert from 'node:assert/strict';
import { canDeleteSourceFile, isCamogPhotoFileName } from '../lib/storage/photo-file-name.ts';

const UUID = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const same = 1024;

// 1. Only exact Camog photo filenames pass the gate.
assert.equal(isCamogPhotoFileName(`${UUID}.jpg`), true, 'photo file name');
assert.equal(isCamogPhotoFileName(`${UUID}.thumb.jpg`), true, 'thumbnail file name');
// Everything a user's own folder might contain is rejected.
assert.equal(isCamogPhotoFileName('IMG_001.jpg'), false, 'camera name rejected');
assert.equal(isCamogPhotoFileName('photo.jpg'), false, 'generic name rejected');
assert.equal(isCamogPhotoFileName(`${UUID.toUpperCase()}.jpg`), false, 'uppercase uuid rejected');
assert.equal(isCamogPhotoFileName(`${UUID}.png`), false, 'wrong extension rejected');
assert.equal(isCamogPhotoFileName(`${UUID}.thumb.jpg.bak`), false, 'trailing suffix rejected');
assert.equal(isCamogPhotoFileName(`${UUID}.jpg.exe`), false, 'double extension rejected');
assert.equal(isCamogPhotoFileName(`../../${UUID}.jpg`), false, 'path in name rejected');
assert.equal(isCamogPhotoFileName(''), false, 'empty rejected');

// 2. A Camog-named file deletes only when the copy is verified.
assert.equal(canDeleteSourceFile(`${UUID}.jpg`, same, same), true, 'verified copy deletes');
assert.equal(canDeleteSourceFile(`${UUID}.thumb.jpg`, same, same), true, 'thumbnail copy deletes');

// 3. Unverified or mismatched copies keep the original.
assert.equal(canDeleteSourceFile(`${UUID}.jpg`, same, null), false, 'missing copy keeps original');
assert.equal(canDeleteSourceFile(`${UUID}.jpg`, null, same), false, 'missing source stat keeps');
assert.equal(canDeleteSourceFile(`${UUID}.jpg`, same, same + 1), false, 'size mismatch keeps');
assert.equal(canDeleteSourceFile(`${UUID}.jpg`, same, 0), false, 'empty copy keeps original');
assert.equal(canDeleteSourceFile('IMG_001.jpg', same, same), false, 'non-Camog name never deletes');

console.log('storage-cleanup self-check passed (3 rule groups).');
