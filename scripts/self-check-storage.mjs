// Self-check for the photos-dir path validation (photosDirSchema).
// Run: node scripts/self-check-storage.mjs
// ponytail: mirrors the predicate in lib/validators/schemas.ts because Node
// cannot import the TS module graph directly; if you change the schema rules,
// update the mirror here. Upgrade path: run via tsx/ts-node in CI.

import assert from 'node:assert/strict';
import { z } from 'zod';

const photosDirSchema = z
  .string()
  .min(1, 'Choose a folder for photo storage')
  .max(1024)
  .refine(
    (p) => p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p),
    'Enter an absolute folder path'
  );

// Valid: absolute POSIX, Windows drive (both slash styles), UNC.
assert.equal(photosDirSchema.safeParse('/Users/x/Photos').success, true);
assert.equal(photosDirSchema.safeParse('C:\\Users\\x\\OneDrive\\Camog').success, true);
assert.equal(photosDirSchema.safeParse('C:/Users/x/Camog').success, true);
assert.equal(photosDirSchema.safeParse('\\\\server\\share\\Camog').success, true);

// Invalid: relative, empty, cwd-relative drive-less, too long.
assert.equal(photosDirSchema.safeParse('Photos').success, false);
assert.equal(photosDirSchema.safeParse('./Photos').success, false);
assert.equal(photosDirSchema.safeParse('').success, false);
assert.equal(photosDirSchema.safeParse('photos/'.repeat(200)).success, false);

console.log('storage self-check passed');
