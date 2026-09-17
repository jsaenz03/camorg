/**
 * Camog licence activation worker.
 *
 * POST /v1/activate  { key, deviceId } → 200 { token }
 *   Verifies the Ed25519-signed licence key, counts device seats in D1, and
 *   returns a server-signed activation token bound to (licence fp, deviceId).
 * POST /v1/validate { key, deviceId } → 200 { valid, exp, renewal? }
 *   Read-only seat re-check for already-activated installs: the app calls
 *   this on open (at most daily) so a revoked seat or expired licence takes
 *   effect without waiting out the token's full term. Writes nothing —
 *   unlike /v1/activate, a call here can never un-revoke a seat. `renewal`
 *   carries the successor key minted by a paid subscription cycle
 *   (specs/005-licence-auto-renew); the app installs it itself when
 *   auto-renew is on.
 * GET/DELETE /v1/seats — admin (Bearer ADMIN_TOKEN): list and revoke seats
 *   (support-driven seat moves; revoke is soft so history survives).
 * POST /webhooks/stripe — purchase fulfilment: verifies Stripe's signature,
 *   signs a 12-month licence key, records it in D1 (licences table) and
 *   emails it to the buyer via Resend (runbook: ./README.md). Covers both
 *   the origin purchase (checkout.session.completed; subscription_id is
 *   recorded when the session was subscription mode) and each annual
 *   renewal (invoice.paid, billing_reason subscription_cycle), which mints
 *   a successor key chained to its predecessor via renews_fp.
 * GET /v1/licences — admin: look up an issued key by ?session= or ?fp=, or
 *   the latest orders (support: resend a key, fulfil an unmapped session).
 * Everything else: static assets (public/legal/*.md, landing page, /buy).
 *
 * Deployment: ./README.md. Storage schema: ./schema.sql.
 */

import {
  ActivationError,
  decideSeat,
  issueLicence,
  issueToken,
  licenceFingerprint,
  SUPPORT_EMAIL,
  verifyLicence,
} from './activation.mjs';
import {
  EMAIL_FROM,
  buildEmail,
  constantTimeEqual,
  extractOrder,
  extractRenewal,
  verifyStripeSignature,
} from './fulfil.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS = {
  bad_request: 400,
  invalid_key: 400,
  seat_limit: 409,
  expired: 410,
  revoked: 403,
  not_activated: 404,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Admin bearer check in constant time: compare SHA-256 digests, never the
// raw token (JS string comparison leaks length/prefix on mismatch).
const isAdmin = async (request, env) => {
  if (typeof env.ADMIN_TOKEN !== 'string' || env.ADMIN_TOKEN.length < 16) return false;
  const [present, expected] = await Promise.all([
    sha256Hex(request.headers.get('Authorization') ?? ''),
    sha256Hex(`Bearer ${env.ADMIN_TOKEN}`),
  ]);
  return constantTimeEqual(present, expected);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/v1/activate') {
        return await activate(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/v1/validate') {
        return await validate(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
        return await fulfilStripe(request, env);
      }
      if (url.pathname === '/v1/seats') {
        if (!(await isAdmin(request, env))) return json({ error: 'unauthorised' }, 401);
        if (request.method === 'GET') return await listSeats(url, env);
        if (request.method === 'DELETE') return await revokeSeat(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/v1/licences') {
        if (!(await isAdmin(request, env))) return json({ error: 'unauthorised' }, 401);
        return await listLicences(url, env);
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

/**
 * Seat re-check for installs that already hold a token. Deliberately the
 * read-only mirror of activate: same input validation and licence checks,
 * but the activations row is only ever SELECTed, so a revoked seat stays
 * revoked no matter how often the app asks.
 *
 * The response also carries auto-renewal (specs/005-licence-auto-renew):
 * when a successor key has been minted for the presented key (a paid
 * subscription cycle), its key_text rides home in `renewal`. Only a device
 * holding an unrevoked seat on the predecessor ever sees it — and Stripe
 * emailed the same key to the buyer anyway, so this hands over nothing the
 * licence owner doesn't already have. Seat checks run before the expiry
 * verdict: a revoked seat must not collect its successor even after the
 * old key has lapsed.
 */
async function validate(request, env) {
  const body = await request.json().catch(() => null);
  const key = typeof body?.key === 'string' ? body.key : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
  if (!key.trim()) throw new ActivationError('bad_request', 'Missing licence key.');
  if (!UUID_RE.test(deviceId)) throw new ActivationError('bad_request', 'Missing or malformed device ID.');

  const licence = await verifyLicence(key, env.LICENCE_PUBLIC_KEY);

  const fp = await licenceFingerprint(key);
  const seat = await env.DB
    .prepare('SELECT revoked FROM activations WHERE fp = ?1 AND device_id = ?2')
    .bind(fp, deviceId)
    .first();
  if (!seat) {
    throw new ActivationError(
      'not_activated',
      'This licence is not activated on this device. Activate to continue.',
    );
  }
  if (seat.revoked) {
    throw new ActivationError(
      'revoked',
      `This device's licence seat has been revoked. Activate again, or contact ${SUPPORT_EMAIL} to move the seat back.`,
    );
  }

  // The successor: newest unexpired key minted to replace this one. An
  // expired presented key with a paid successor answers 200 instead of the
  // 410 so the app can install it and recover on its own.
  const successor = await env.DB
    .prepare(
      `SELECT key_text FROM licences
       WHERE renews_fp = ?1 AND key_text IS NOT NULL AND expires_at > ?2
       ORDER BY issued_at DESC LIMIT 1`,
    )
    .bind(fp, Date.now())
    .first();
  const renewal = successor?.key_text ?? null;

  if (licence.expiresAt <= Date.now()) {
    if (renewal) return json({ valid: false, exp: licence.expiresAt, renewal });
    throw new ActivationError('expired', 'This licence has expired. Contact your vendor to renew.');
  }
  // The offer rides along only when one exists — the everyday answer keeps
  // its pre-renewal shape.
  return json({ valid: true, exp: licence.expiresAt, ...(renewal ? { renewal } : {}) });
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

/**
 * Purchase fulfilment. Every completed session is recorded once (keyed on
 * the Stripe session id, so webhook retries are idempotent); the key is
 * minted at first sight, and a failed email leaves emailed_at NULL so the
 * Stripe retry path re-attempts delivery instead of minting a second key.
 * Sessions whose Payment Link metadata lacks a valid tier/seats are recorded
 * with tier NULL and NOT emailed — support fulfils them by hand (README).
 */
async function fulfilStripe(request, env) {
  const raw = await request.text();
  const ok = await verifyStripeSignature(
    raw,
    request.headers.get('stripe-signature') ?? '',
    env.STRIPE_WEBHOOK_SECRET ?? '',
  );
  if (!ok) return json({ error: 'bad_signature' }, 400);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_payload' }, 400);
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.paid'].includes(event?.type)) {
    return json({ received: true });
  }
  if (event.type === 'invoice.paid') return await fulfilRenewal(env, event.data?.object);
  const session = event.data?.object;
  if (session?.payment_status !== 'paid') return json({ received: true });
  const order = extractOrder(session);
  if (!order.sessionId) return json({ error: 'bad_payload' }, 400);

  let row = await env.DB.prepare('SELECT * FROM licences WHERE session_id = ?1').bind(order.sessionId).first();
  if (!row) {
    let key = null;
    let fp = null;
    let expiresAt = null;
    if (order.tier && order.seats) {
      key = await issueLicence(
        { practice: order.practice, tier: order.tier, seats: order.seats, months: 12 },
        env.LICENCE_PRIVATE_KEY,
      );
      // Verify what we minted with the same path the app's keys go through.
      const payload = await verifyLicence(key, env.LICENCE_PUBLIC_KEY);
      fp = await licenceFingerprint(key);
      expiresAt = payload.expiresAt;
    }
    // session.subscription is set when the Payment Link was subscription
    // mode (specs/005-licence-auto-renew) — the renewal chain hangs off it.
    const subscriptionId = typeof session?.subscription === 'string' ? session.subscription : null;
    await env.DB
      .prepare(
        `INSERT INTO licences (session_id, email, practice, tier, seats, key_text, key_fp, expires_at, issued_at, emailed_at, subscription_id, renews_fp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, NULL)`,
      )
      .bind(order.sessionId, order.email, order.practice, order.tier, order.seats, key, fp, expiresAt, Date.now(), subscriptionId)
      .run();
    row = await env.DB.prepare('SELECT * FROM licences WHERE session_id = ?1').bind(order.sessionId).first();
  }

  if (!row.key_text) return json({ received: true, note: 'unmapped_tier_recorded' });
  return json(await deliverKey(env, row));
}

/**
 * Emails a recorded key once; a failed send leaves emailed_at NULL so
 * Stripe's webhook retry re-attempts delivery instead of minting again.
 * Shared by the origin purchase and renewal paths.
 */
async function deliverKey(env, row) {
  if (!row.emailed_at) {
    if (!row.email) return { received: true, note: 'no_email_recorded' };
    const { subject, text, html } = buildEmail({
      practice: row.practice,
      tier: row.tier,
      seats: row.seats,
      key: row.key_text,
      expiresAt: row.expires_at,
    });
    await sendLicenceEmail(env, row.email, subject, text, html);
    await env.DB
      .prepare('UPDATE licences SET emailed_at = ?2 WHERE session_id = ?1')
      .bind(row.session_id, Date.now())
      .run();
  }
  return { received: true };
}

/**
 * Auto-renew (specs/005-licence-auto-renew). A paid subscription-cycle
 * invoice mints a successor key: same practice/tier/seats as the chain tip
 * (the newest successfully minted key under the subscription), a fresh
 * 12-month term from the payment date, row keyed on the invoice id so
 * webhook retries stay idempotent, and chained to the tip via renews_fp.
 * The key is also emailed — the buyer's off-app record and the fallback
 * for installs running with auto-renew off. It only ever reaches a device
 * through /v1/validate, which requires an unrevoked seat on the
 * predecessor key.
 */
async function fulfilRenewal(env, invoice) {
  const renewal = extractRenewal(invoice);
  if (!renewal) return json({ received: true, note: 'not_a_cycle_invoice' });

  let row = await env.DB.prepare('SELECT * FROM licences WHERE session_id = ?1').bind(renewal.invoiceId).first();
  if (!row) {
    const tip = await env.DB
      .prepare(
        `SELECT * FROM licences WHERE subscription_id = ?1 AND key_text IS NOT NULL
         ORDER BY issued_at DESC LIMIT 1`,
      )
      .bind(renewal.subscriptionId)
      .first();
    if (!tip) return json({ received: true, note: 'unmapped_subscription_recorded' });
    const key = await issueLicence(
      { practice: tip.practice, tier: tip.tier, seats: tip.seats, months: 12 },
      env.LICENCE_PRIVATE_KEY,
    );
    // Verify what we minted with the same path the app's keys go through.
    const payload = await verifyLicence(key, env.LICENCE_PUBLIC_KEY);
    await env.DB
      .prepare(
        `INSERT INTO licences (session_id, email, practice, tier, seats, key_text, key_fp, expires_at, issued_at, emailed_at, subscription_id, renews_fp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11)`,
      )
      .bind(
        renewal.invoiceId,
        tip.email,
        tip.practice,
        tip.tier,
        tip.seats,
        key,
        await licenceFingerprint(key),
        payload.expiresAt,
        Date.now(),
        renewal.subscriptionId,
        tip.key_fp,
      )
      .run();
    row = await env.DB.prepare('SELECT * FROM licences WHERE session_id = ?1').bind(renewal.invoiceId).first();
  }

  if (!row.key_text) return json({ received: true, note: 'unmapped_subscription_recorded' });
  return json(await deliverKey(env, row));
}

async function sendLicenceEmail(env, to, subject, text, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      reply_to: SUPPORT_EMAIL,
      subject,
      text,
      html,
      // Inline header logo (cid:cliniciq-logo in the template) — same asset
      // the licence-keygen GUI embeds over SMTP; Resend fetches it from this
      // worker's public assets, so no bytes ride in the bundle.
      attachments: [
        {
          filename: 'logo-email.png',
          path: 'https://camog-license.cliniciq.com.au/logo-email.png',
          content_type: 'image/png',
          content_id: 'cliniciq-logo',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Resend delivery failed (${res.status})`);
}

/** Admin: find an issued key for support (resend / manual fulfilment). */
async function listLicences(url, env) {
  const session = url.searchParams.get('session');
  const fp = url.searchParams.get('fp');
  if (session) {
    const licence = await env.DB
      .prepare('SELECT * FROM licences WHERE session_id = ?1')
      .bind(session)
      .first();
    return json({ licence: licence ?? null });
  }
  if (fp) {
    if (!/^[0-9a-f]{64}$/.test(fp)) {
      throw new ActivationError('bad_request', 'Pass ?fp=<licence fingerprint> (sha-256 hex).');
    }
    const { results } = await env.DB
      .prepare('SELECT * FROM licences WHERE key_fp = ?1')
      .bind(fp)
      .all();
    return json({ fp, licences: results ?? [] });
  }
  // Latest orders for a support sweep — full keys only in the ?session=/
  // ?fp= lookups, not dumped for every row at once.
  const { results } = await env.DB
    .prepare(
      `SELECT session_id, email, practice, tier, seats, key_fp, expires_at, issued_at, emailed_at
       FROM licences ORDER BY issued_at DESC LIMIT 50`,
    )
    .all();
  return json({ licences: results ?? [] });
}
