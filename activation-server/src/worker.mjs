/**
 * Camog licence activation worker.
 *
 * POST /v1/activate  { key, deviceId } → 200 { token }
 *   Verifies the Ed25519-signed licence key, counts device seats in D1, and
 *   returns a server-signed activation token bound to (licence fp, deviceId).
 * GET/DELETE /v1/seats — admin (Bearer ADMIN_TOKEN): list and revoke seats
 *   (support-driven seat moves; revoke is soft so history survives).
 * Everything else: static assets (public/legal/*.md, landing page).
 *
 * Deployment: ./README.md. Storage schema: ./schema.sql.
 */

import {
  ActivationError,
  decideSeat,
  issueToken,
  licenceFingerprint,
  verifyLicence,
} from './activation.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS = { bad_request: 400, invalid_key: 400, seat_limit: 409, expired: 410 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const isAdmin = (request, env) =>
  typeof env.ADMIN_TOKEN === 'string' &&
  env.ADMIN_TOKEN.length >= 16 &&
  request.headers.get('Authorization') === `Bearer ${env.ADMIN_TOKEN}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/v1/activate') {
        return await activate(request, env);
      }
      if (url.pathname === '/v1/seats') {
        if (!isAdmin(request, env)) return json({ error: 'unauthorised' }, 401);
        if (request.method === 'GET') return await listSeats(url, env);
        if (request.method === 'DELETE') return await revokeSeat(request, env);
      }
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      if (err instanceof ActivationError) {
        return json({ error: err.code, message: err.message }, STATUS[err.code] ?? 400);
      }
      console.error('activation worker error:', err);
      return json({ error: 'server', message: 'Activation server error. Try again shortly.' }, 500);
    }
  },
};

async function activate(request, env) {
  const body = await request.json().catch(() => null);
  const key = typeof body?.key === 'string' ? body.key : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
  if (!key.trim()) throw new ActivationError('bad_request', 'Missing licence key.');
  if (!UUID_RE.test(deviceId)) throw new ActivationError('bad_request', 'Missing or malformed device ID.');

  const licence = await verifyLicence(key, env.LICENCE_PUBLIC_KEY);
  if (licence.expiresAt <= Date.now()) {
    throw new ActivationError('expired', 'This licence has expired. Contact your vendor to renew.');
  }

  const fp = await licenceFingerprint(key);
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM activations WHERE fp = ?1 AND revoked = 0')
    .bind(fp)
    .first();
  const known = await env.DB
    .prepare('SELECT 1 AS x FROM activations WHERE fp = ?1 AND device_id = ?2')
    .bind(fp, deviceId)
    .first();
  decideSeat({ seats: licence.seats, activeCount: row?.n ?? 0, deviceExists: Boolean(known) });

  // ponytail: count-then-insert is not serialised — two simultaneous first
  // activations of the same key could overshoot its seats by one. Requires
  // possessing the secret key; upgrade path is a D1 batch with a conditional
  // INSERT if seat races ever matter.
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO activations (fp, device_id, activated_at, last_activated_at, revoked)
       VALUES (?1, ?2, ?3, ?3, 0)
       ON CONFLICT(fp, device_id) DO UPDATE SET revoked = 0, last_activated_at = ?3`,
    )
    .bind(fp, deviceId, now)
    .run();

  const token = await issueToken({ fp, deviceId, exp: licence.expiresAt }, env.TOKEN_SIGNING_KEY);
  return json({ token });
}

async function listSeats(url, env) {
  const fp = url.searchParams.get('fp') ?? '';
  if (!/^[0-9a-f]{64}$/.test(fp)) {
    throw new ActivationError('bad_request', 'Pass ?fp=<licence fingerprint> (sha-256 hex).');
  }
  const { results } = await env.DB
    .prepare(
      `SELECT device_id, activated_at, last_activated_at, revoked
       FROM activations WHERE fp = ?1 ORDER BY activated_at`,
    )
    .bind(fp)
    .all();
  return json({ fp, seats: results ?? [] });
}

async function revokeSeat(request, env) {
  const body = await request.json().catch(() => null);
  const fp = typeof body?.fp === 'string' ? body.fp : '';
  if (!/^[0-9a-f]{64}$/.test(fp)) {
    throw new ActivationError('bad_request', 'Missing or malformed licence fingerprint.');
  }
  let sql;
  let bindings;
  if (body.all === true) {
    sql = 'UPDATE activations SET revoked = 1 WHERE fp = ?1 AND revoked = 0';
    bindings = [fp];
  } else {
    if (!UUID_RE.test(body?.deviceId ?? '')) {
      throw new ActivationError('bad_request', 'Provide deviceId (uuid) or all: true.');
    }
    sql = 'UPDATE activations SET revoked = 1 WHERE fp = ?1 AND device_id = ?2 AND revoked = 0';
    bindings = [fp, body.deviceId];
  }
  const res = await env.DB.prepare(sql).bind(...bindings).run();
  return json({ fp, revoked: res.meta?.changes ?? 0 });
}
