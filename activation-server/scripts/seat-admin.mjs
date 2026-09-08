#!/usr/bin/env node
/**
 * Seat administration CLI — list and revoke licence seats on the activation
 * server (the support path for "move my seat to a new computer" requests).
 *
 * Usage:
 *   node activation-server/scripts/seat-admin.mjs fp     --key <licence key>
 *   node activation-server/scripts/seat-admin.mjs list   --url <base> --fp <fingerprint>
 *   node activation-server/scripts/seat-admin.mjs revoke --url <base> --fp <fingerprint> (--device <uuid> | --all)
 *
 * Requires CAMOG_ADMIN_TOKEN in the environment (the worker's ADMIN_TOKEN
 * secret). <base> is the deployed worker root, e.g.
 * https://camog-license.cliniciq.com.au
 */

import { licenceFingerprint } from '../src/activation.mjs';

const [cmd, ...rest] = process.argv.slice(2);

function arg(name) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

const base = (arg('url') ?? '').replace(/\/+$/, '');
const token = process.env.CAMOG_ADMIN_TOKEN;

async function call(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${body.message ?? body.error ?? 'request failed'}`);
    process.exit(1);
  }
  return body;
}

if (cmd === 'fp') {
  const key = arg('key');
  if (!key) {
    console.error('Usage: seat-admin.mjs fp --key <licence key>');
    process.exit(1);
  }
  console.log(await licenceFingerprint(key));
} else if (cmd === 'list') {
  if (!base || !arg('fp') || !token) {
    console.error('Usage: seat-admin.mjs list --url <base> --fp <fingerprint>   (env CAMOG_ADMIN_TOKEN)');
    process.exit(1);
  }
  const { seats } = await call(`/v1/seats?fp=${arg('fp')}`);
  if (seats.length === 0) console.log('No activations recorded for this licence.');
  for (const s of seats) {
    console.log(
      `${s.revoked ? '[revoked] ' : '[active ] '}${s.device_id}  activated ${new Date(s.activated_at).toISOString()}  last ${new Date(s.last_activated_at).toISOString()}`,
    );
  }
} else if (cmd === 'revoke') {
  const device = arg('device');
  const all = rest.includes('--all');
  if (!base || !arg('fp') || !token || (!device && !all)) {
    console.error('Usage: seat-admin.mjs revoke --url <base> --fp <fingerprint> (--device <uuid> | --all)');
    process.exit(1);
  }
  const body = await call('/v1/seats', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fp: arg('fp'), ...(all ? { all: true } : { deviceId: device }) }),
  });
  console.log(`Revoked ${body.revoked} seat${body.revoked === 1 ? '' : 's'}.`);
} else {
  console.error('Unknown command. Use: fp | list | revoke');
  process.exit(1);
}
