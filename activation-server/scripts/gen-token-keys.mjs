#!/usr/bin/env node
/**
 * Generates the activation server's Ed25519 token-signing keypair (one time).
 *
 * Private key → .keys/activation-token-ed25519.private.hex (gitignored, then
 * uploaded as the TOKEN_SIGNING_KEY wrangler secret — never committed).
 * Public key  → .keys/activation-token-ed25519.public.hex, embedded in
 * lib/licence/activation-public-key.ts so every install can verify tokens
 * offline.
 *
 * Run: node activation-server/scripts/gen-token-keys.mjs
 */

import { keygenAsync } from '@noble/ed25519';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keysDir = process.env.CAMOG_LICENCE_KEYS_DIR || join(root, '.keys');
const privatePath = join(keysDir, 'activation-token-ed25519.private.hex');
const publicPath = join(keysDir, 'activation-token-ed25519.public.hex');

const hex = (bytes) => Buffer.from(bytes).toString('hex');

if (existsSync(privatePath)) {
  console.error(`Private key already exists at ${privatePath} — refusing to overwrite.`);
  console.error('Public key: see .keys/activation-token-ed25519.public.hex');
  process.exit(1);
}

mkdirSync(keysDir, { recursive: true });
const { secretKey, publicKey } = await keygenAsync();
writeFileSync(privatePath, hex(secretKey) + '\n', { mode: 0o600 });
writeFileSync(publicPath, hex(publicKey) + '\n');

console.log(`Private key: ${privatePath} (keep secret, never commit)`);
console.log(`Public key:  ${publicPath}`);
console.log(`
Next steps (activation-server/README.md):

  1. wrangler secret put TOKEN_SIGNING_KEY < .keys/activation-token-ed25519.private.hex
  2. Embed the public key in lib/licence/activation-public-key.ts:

       export const ACTIVATION_PUBLIC_KEY_HEX = '${hex(publicKey)}';
`);
