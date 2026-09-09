// Self-check for the silent provenance marks (src-tauri/src/provenance.rs).
//
// Run: node scripts/self-check-provenance.mjs
//
// Provenance is layered so no single file carries the whole ownership
// trail; this script audits every layer and fails loudly if one goes
// missing from a build:
//   1. LICENSE copyright;
//   2. Cargo package metadata (authors/description);
//   3. Tauri bundle identifier + copyright (Info.plist / PE version info);
//   4. the compiled-in marker, stamped into every generated PDF's
//      document-info Creator by report.rs;
//   5. the exported HTML meta tag (app/layout.tsx);
//   6. any built binary under src-tauri/target/release, scanned for the app
//      identifier (skipped on source-only runs — nothing built yet).
// Ownership audit of a specific artifact (binary or generated PDF):
//   node scripts/self-check-provenance.mjs <file>
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const MARKER = 'com.camog.app';
const FULL_MARKER = 'com.camog.app - Copyright (C) 2026 Camog. All rights reserved.';

// Artifact audit mode: `node scripts/self-check-provenance.mjs <file>`
// scans one built binary or generated PDF for the full provenance sentence
// (the const in provenance.rs, stamped in by report.rs). This is the
// ownership check to run on any artifact of doubtful origin — note it only
// holds for binaries/PDFs built after the mark landed.
if (process.argv[2]) {
  const bytes = readFileSync(process.argv[2]);
  assert.ok(
    bytes.includes(Buffer.from(FULL_MARKER, 'utf8')),
    `${process.argv[2]} does not carry the provenance mark (predates it, or it was stripped)`,
  );
  console.log(`provenance verified in ${process.argv[2]}`);
  process.exit(0);
}

// 1. LICENSE — the legal anchor.
assert.match(
  read('LICENSE'),
  /Copyright © 2026 Camog\. All rights reserved\./,
  'LICENSE must carry the Camog copyright',
);

// 2. Cargo package metadata — rides along in crate metadata of any build.
const cargo = read('src-tauri/Cargo.toml');
assert.ok(cargo.includes('authors = ["Camog"]'), 'Cargo.toml authors must credit Camog');
assert.match(
  cargo,
  /description = "Camog — Clinical Photo Documentation"/,
  'Cargo.toml description must name the product',
);

// 3. Tauri bundle metadata — Info.plist / Windows version resources.
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
assert.equal(conf.identifier, MARKER, 'bundle identifier must stay the Camog app id');
assert.match(
  conf.bundle.copyright ?? '',
  /Copyright © 2026 Camog/,
  'bundle copyright must carry the Camog notice',
);

// 4. The compiled-in marker, stamped into every generated PDF.
const provenance = read('src-tauri/src/provenance.rs');
assert.ok(
  provenance.includes(`${MARKER} - Copyright (C) 2026 Camog. All rights reserved.`),
  'provenance.rs must carry the full ASCII marker',
);
assert.ok(
  read('src-tauri/src/report.rs').includes('provenance::PROVENANCE'),
  'report metadata must stamp the marker into generated PDFs',
);

// 5. Exported HTML head.
assert.ok(
  read('app/layout.tsx').includes('"camog-provenance"'),
  'layout.tsx must emit the provenance meta tag',
);

// 6. Built binaries — only when a release build exists. Scans for the app
// identifier, which the Tauri context embeds in every build regardless of
// age; the full sentence is asserted by the artifact-audit mode above.
const releaseDir = join(root, 'src-tauri', 'target', 'release');
let scanned = 0;
if (existsSync(releaseDir)) {
  for (const entry of readdirSync(releaseDir)) {
    const path = join(releaseDir, entry);
    const stat = statSync(path);
    // Executables only: target/release also collects Finder/tool litter
    // (.DS_Store, .d dependency files) that is not part of the artifact.
    if (!stat.isFile() || entry.startsWith('.') || !(stat.mode & 0o111)) continue;
    scanned += 1;
    const bytes = readFileSync(path);
    assert.ok(
      bytes.includes(Buffer.from(MARKER, 'utf8')),
      `built binary ${entry} must contain the app identifier`,
    );
  }
}

console.log(
  `provenance self-check passed (6 source layers${
    scanned > 0 ? `, ${scanned} built file(s) scanned` : ', no build to scan'
  })`,
);
