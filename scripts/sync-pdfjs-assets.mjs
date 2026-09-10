/**
 * Syncs the pdf.js runtime assets from node_modules into public/pdfjs/ so the
 * in-app result-file viewer can load its worker and standard fonts from the
 * app's own origin (required by the packaged CSP and the Tauri static export).
 *
 * Run automatically via the `predev`/`prebuild` npm hooks, so the copied
 * worker always matches the installed pdfjs-dist version.
 *
 * Fails loudly (non-zero exit) if pdfjs-dist is missing or an asset is absent.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'public', 'pdfjs');

const assets = [
  { from: 'build/pdf.worker.min.mjs', to: 'pdf.worker.min.mjs' },
  { from: 'standard_fonts', to: 'standard_fonts' },
];

if (!existsSync(join(dist, 'package.json'))) {
  console.error('pdfjs-dist is not installed — run npm install first.');
  process.exit(1);
}
for (const { from } of assets) {
  if (!existsSync(join(dist, from))) {
    console.error(`pdfjs-dist ${from} is missing — was the package layout changed?`);
    process.exit(1);
  }
}

mkdirSync(target, { recursive: true });
for (const { from, to } of assets) {
  cpSync(join(dist, from), join(target, to), { recursive: true, force: true });
}

console.log('pdf.js assets synced → public/pdfjs/');
