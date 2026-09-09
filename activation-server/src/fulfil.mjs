/**
 * Camog licence fulfilment — pure logic for the Stripe webhook (routing, D1
 * and the Resend call live in worker.mjs; this module is shared with
 * scripts/self-check-licence-fulfilment.mjs).
 *
 * Each Stripe Payment Link carries {tier, seats} in its metadata (Stripe
 * copies it onto every checkout session) and an optional "practice" custom
 * field. On checkout.session.completed the worker verifies Stripe's
 * signature, extracts the order, signs a 12-month licence key with the
 * vendor private key, records it in D1 and emails it via Resend. The app
 * stays checkout-free — its whole purchase surface is the /buy link.
 */

import { TIERS } from './activation.mjs';

// Stripe's own SDKs reject signatures older than 5 minutes.
const STRIPE_TOLERANCE_MS = 5 * 60 * 1000;

export const EMAIL_FROM = 'ClinicIQ Licences <licences@cliniciq.com.au>';

/**
 * Verifies Stripe's `Stripe-Signature` header (scheme v1: hex
 * HMAC-SHA256 of `${t}.${rawBody}` keyed with the webhook secret) using only
 * Web APIs — Workers have no Buffer and no Stripe SDK.
 */
export async function verifyStripeSignature(rawBody, signatureHeader, secret, now = Date.now()) {
  if (typeof rawBody !== 'string' || typeof signatureHeader !== 'string' || typeof secret !== 'string' || secret.length < 16) {
    return false;
  }
  const parts = signatureHeader
    .split(',')
    .map((piece) => {
      const eq = piece.indexOf('=');
      return eq < 0 ? null : [piece.slice(0, eq).trim(), piece.slice(eq + 1).trim()];
    })
    .filter(Boolean);
  const t = parts.find(([k]) => k === 't')?.[1];
  if (!t || !/^\d+$/.test(t)) return false;
  if (Math.abs(now - Number(t) * 1000) > STRIPE_TOLERANCE_MS) return false;
  const provided = parts.filter(([k]) => k === 'v1').map(([, v]) => v.toLowerCase());
  if (provided.length === 0) return false;
  const expected = await hexHmacSha256(secret, `${t}.${rawBody}`);
  return provided.some((v) => constantTimeEqual(v, expected));
}

async function hexHmacSha256(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex comparison (also used for the admin bearer check). */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Buyer-typed values cross a trust boundary into D1, the signed licence
// payload and the delivery email — strip control characters and bound
// lengths before anything downstream sees them.
const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Extracts a fulfilment order from a Stripe checkout session. tier/seats are
 * null when the Payment Link metadata is missing or malformed — the session
 * is still recorded so support can fulfil it by hand (never silently lost).
 */
export function extractOrder(session) {
  const meta = session?.metadata ?? {};
  const tier = TIERS.includes(meta.tier) ? meta.tier : null;
  const seatsNum = Number(meta.seats);
  const seats = Number.isInteger(seatsNum) && seatsNum > 0 && seatsNum <= 1000 ? seatsNum : null;
  const emailRaw = session?.customer_details?.email || session?.customer_email || null;
  const email = emailRaw ? cleanText(emailRaw, 320) : null;
  const custom = Array.isArray(session?.custom_fields)
    ? session.custom_fields.find((f) => f?.key === 'practice')?.text?.value ?? null
    : null;
  const practice =
    cleanText(custom || session?.customer_details?.name || emailLocalPart(email) || '', 200) ||
    'Unnamed practice';
  return {
    sessionId: typeof session?.id === 'string' ? session.id : null,
    email,
    practice,
    tier,
    seats,
  };
}

const emailLocalPart = (email) => (email && email.includes('@') ? email.split('@')[0] : null);

/** DD/MM/YYYY for emails (AU convention everywhere customer-facing). */
export function formatDateAU(ms) {
  const d = new Date(ms);
  const dd = (n) => String(n).padStart(2, '0');
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The delivery email: key, term, and how to activate. Plain text + HTML. */
export function buildEmail({ practice, tier, seats, key, expiresAt }) {
  const expiry = formatDateAU(expiresAt);
  const tierLabel = tier ? tier[0].toUpperCase() + tier.slice(1) : '—';
  const subject = `Your Camog licence key (${practice})`;
  const text = `Hi ${practice},

Thank you for your purchase. Here is the licence key for Camog; it unlocks ${seats} seat${seats === 1 ? '' : 's'} and is valid until ${expiry}.

LICENCE KEY
${key}

Product: Camog (clinical photo documentation by ClinicIQ Solutions)
Licensed to: ${practice}
Tier: ${tierLabel}
Seats: ${seats}
Valid until: ${expiry}

To activate: open Camog, choose Activate (or Settings → Licence), and paste
the key above. Activation needs a one-time internet connection; after that
Camog runs fully offline for the licence term. Line breaks from email
wrapping are fine.

Keep this email for your records. To renew, buy again before the expiry date
and activate the new key. Questions? Just reply to this email.

ClinicIQ Solutions
`;
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.55;color:#1c1c1e;max-width:38rem">
  <p>Hi ${escapeHtml(practice)},</p>
  <p>Thank you for your purchase. Here is the licence key for <strong>Camog</strong>; it unlocks ${seats} seat${seats === 1 ? '' : 's'} and is valid until <strong>${expiry}</strong>.</p>
  <p style="font-family:ui-monospace,monospace;font-size:13px;background:#f2f2f4;padding:12px;border-radius:6px;word-break:break-all">${escapeHtml(key)}</p>
  <table style="font-size:14px">
    <tr><td style="padding-right:16px;color:#555">Licensed to</td><td>${escapeHtml(practice)}</td></tr>
    <tr><td style="padding-right:16px;color:#555">Tier</td><td>${escapeHtml(tierLabel)}</td></tr>
    <tr><td style="padding-right:16px;color:#555">Seats</td><td>${seats}</td></tr>
    <tr><td style="padding-right:16px;color:#555">Valid until</td><td>${expiry}</td></tr>
  </table>
  <p>To activate: open Camog, choose <strong>Activate</strong> (or Settings → Licence), and paste the key above. Activation needs a one-time internet connection; after that Camog runs fully offline for the licence term. Line breaks from email wrapping are fine.</p>
  <p style="color:#555">Keep this email for your records. To renew, buy again before the expiry date and activate the new key. Questions? Just reply to this email.</p>
  <p>ClinicIQ Solutions</p>
</div>`;
  return { subject, text, html };
}
