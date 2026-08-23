#!/usr/bin/env node
/**
 * Camog licence keygen — issues offline Ed25519-signed licence keys.
 *
 * Subcommands:
 *   genkeys                                              one-time vendor keypair
 *   issue --practice "Bay Dermatology" [--tier practice] [--seats 3] [--months 12]
 *                                                        sign + print a licence key
 *   selftest                                             sign/verify asserts
 *
 * Run: node scripts/licence-keygen.mjs <subcommand>
 *
 * Keys live in .keys/ (gitignored); the private key never enters the repo.
 * The PUBLIC key is embedded in lib/licence/public-key.ts and must be the
 * pair of the private key used by `issue`.
 *
 * The parse/verify logic below deliberately mirrors lib/licence/verify.ts
 * (kept in sync like the consent-derivation mirror in check-features.mjs);
 * `selftest` is the runnable proof that issued keys verify in the app format.
 */

import { keygenAsync, signAsync, verifyAsync } from '@noble/ed25519';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keysDir = process.env.CAMOG_LICENCE_KEYS_DIR || join(root, '.keys');
const privatePath = join(keysDir, 'licence-ed25519.private.hex');
const publicPath = join(keysDir, 'licence-ed25519.public.hex');

const TIERS = ['solo', 'practice', 'clinic'];
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s.trim(), 'hex'));

// --- base64url (no padding) — mirrors lib/licence/verify.ts ---
const b64uEncode = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDecode = (s) => new Uint8Array(Buffer.from(s, 'base64'));

function buildPayload({ practice, tier, seats, months, days }) {
  const issuedAt = Date.now();
  const expires = new Date(issuedAt);
  // `days` (may be negative, for testing expiry states) overrides `months`.
  if (days !== undefined) expires.setDate(expires.getDate() + days);
  else expires.setMonth(expires.getMonth() + months);
  return {
    v: 1,
    practice,
    tier,
    seats,
    issuedAt,
    expiresAt: expires.getTime(),
  };
}

async function signKey(payload, secretKey) {
  const message = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await signAsync(message, secretKey);
  return `${b64uEncode(message)}.${b64uEncode(signature)}`;
}

// --- parse + verify — mirrors lib/licence/verify.ts ---
function checkPayloadShape(p) {
  assert.ok(p && typeof p === 'object', 'payload is not an object');
  assert.ok(p.v === 1, 'unknown licence version');
  assert.ok(typeof p.practice === 'string' && p.practice.trim().length > 0, 'missing practice name');
  assert.ok(TIERS.includes(p.tier), `tier must be one of ${TIERS.join('/')}`);
  assert.ok(Number.isInteger(p.seats) && p.seats > 0, 'seats must be a positive integer');
  assert.ok(Number.isFinite(p.issuedAt) && p.issuedAt > 0, 'bad issuedAt');
  assert.ok(Number.isFinite(p.expiresAt) && p.expiresAt > 0, 'bad expiresAt');
}

async function verifyKey(keyStr, publicKey) {
  const parts = keyStr.replace(/\s+/g, '').split('.');
  if (parts.length !== 2) throw new Error('licence key must be payload.signature');
  let payloadBytes;
  try {
    payloadBytes = b64uDecode(parts[0]);
  } catch {
    throw new Error('licence payload is not valid base64url');
  }
  let signature;
  try {
    signature = b64uDecode(parts[1]);
  } catch {
    throw new Error('licence signature is not valid base64url');
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new Error('licence payload is not valid JSON');
  }
  checkPayloadShape(payload);
  if (!(await verifyAsync(signature, payloadBytes, publicKey))) {
    throw new Error('licence signature verification failed');
  }
  return payload;
}

// --- subcommands ---

async function genkeys() {
  if (existsSync(privatePath)) {
    console.error(`Private key already exists at ${privatePath} — refusing to overwrite.`);
    console.error(`Public key: ${readFileSync(publicPath, 'utf8').trim()}`);
    process.exit(1);
  }
  mkdirSync(keysDir, { recursive: true });
  const { secretKey, publicKey } = await keygenAsync();
  writeFileSync(privatePath, hex(secretKey) + '\n', { mode: 0o600 });
  writeFileSync(publicPath, hex(publicKey) + '\n');
  console.log(`Private key: ${privatePath} (keep secret, never commit)`);
  console.log(`Public key:  ${publicPath}`);
  console.log(`\nEmbed this public key in lib/licence/public-key.ts:\n\n  ${hex(publicKey)}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (!name || value === undefined) {
      console.error('Usage: issue --practice "Name" [--tier solo|practice|clinic] [--seats N] [--months M | --days D]');
      process.exit(1);
    }
    out[name] = value;
  }
  return out;
}

async function issue(argv) {
  const args = parseArgs(argv);
  const practice = args.practice;
  if (!practice) {
    console.error('--practice is required');
    process.exit(1);
  }
  const tier = args.tier || 'practice';
  const seats = Number(args.seats || 3);
  const months = Number(args.months || 12);
  // --days overrides --months (negative values issue already-expired keys,
  // useful for testing the read-only states).
  const days = args.days !== undefined ? Number(args.days) : undefined;
  if (days !== undefined && !Number.isFinite(days)) {
    console.error('--days must be a number');
    process.exit(1);
  }
  if (!TIERS.includes(tier)) {
    console.error(`--tier must be one of ${TIERS.join('/')}`);
    process.exit(1);
  }
  if (!existsSync(privatePath)) {
    console.error(`No private key at ${privatePath} — run "genkeys" first.`);
    process.exit(1);
  }
  const secretKey = unhex(readFileSync(privatePath, 'utf8'));
  const payload = buildPayload({ practice, tier, seats, months, days });
  const key = await signKey(payload, secretKey);
  const dd = (n) => String(n).padStart(2, '0');
  const e = new Date(payload.expiresAt);
  console.log(`Licence key for ${practice} (${tier}, ${seats} seat${seats === 1 ? '' : 's'}, expires ${dd(e.getDate())}/${dd(e.getMonth() + 1)}/${e.getFullYear()}):\n`);
  console.log(key);
}

async function selftest() {
  const { secretKey, publicKey } = await keygenAsync();
  const payload = buildPayload({ practice: 'Selftest Clinic', tier: 'practice', seats: 2, months: 12 });

  // 1. A well-formed signed key verifies and round-trips its payload.
  const key = await signKey(payload, secretKey);
  const parsed = await verifyKey(key, publicKey);
  assert.equal(parsed.practice, 'Selftest Clinic');
  assert.equal(parsed.seats, 2);

  // 2. Pasted keys with whitespace/newlines still verify.
  assert.ok(await verifyKey(`\n  ${key.split('.').join('.\n')}  \n`, publicKey), 'whitespace-padded key verifies');

  // 3. Tampered payload fails (keep the signature, alter the payload bytes).
  const keySig = key.split('.')[1];
  const tamperedKey = `${b64uEncode(new TextEncoder().encode(JSON.stringify({ ...parsed, seats: 99 })))}.${keySig}`;
  await assert.rejects(async () => verifyKey(tamperedKey, publicKey), /verification failed/);

  // 4. Signature from a different vendor key fails.
  const other = await keygenAsync();
  await assert.rejects(async () => verifyKey(await signKey(payload, other.secretKey), publicKey), /verification failed/);

  // 5. Malformed inputs throw the expected parse errors.
  await assert.rejects(() => verifyKey('not-a-key', publicKey), /payload\.signature/);
  await assert.rejects(() => verifyKey('aGVsbG8.only', publicKey), /not valid JSON/);

  // 6. Expiry is a payload check (verify passes; state logic flags it).
  const expiredPayload = { ...payload, expiresAt: Date.now() - 1 };
  const expiredKey = await signKey(expiredPayload, secretKey);
  const expiredParsed = await verifyKey(expiredKey, publicKey);
  assert.ok(expiredParsed.expiresAt <= Date.now(), 'expired payload is detectable');

  // 7. Payload shape is enforced before the signature check matters.
  await assert.rejects(
    async () => verifyKey(await signKey({ ...payload, v: 2 }, secretKey), publicKey),
    /unknown licence version/,
  );

  console.log('licence-keygen selftest passed (7 checks).');
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { genkeys, issue, selftest };
if (!commands[cmd]) {
  console.error('Usage: node scripts/licence-keygen.mjs <genkeys|issue|selftest>');
  process.exit(1);
}
await commands[cmd](rest);
