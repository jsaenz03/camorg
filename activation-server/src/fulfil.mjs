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
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Fills {{token}} placeholders; unknown tokens are left verbatim. */
const fillTemplate = (template, values) =>
  String(template).replace(/\{\{(\w+)\}\}/g, (raw, k) => (k in values ? values[k] : raw));

// The licence email, ported verbatim from licence-keygen's
// DEFAULT_EMAIL_TEMPLATE (core.mjs) so keygen-issued and webhook-issued keys
// arrive in the same ClinicIQ livery: navy/gold header with the inline
// cid:cliniciq-logo, key in a gold-edged mono panel, spec table, footer.
// The logo PNG is served from this worker (public/logo-email.png) and
// attached at send time by Resend with a matching content_id.
const LICENCE_EMAIL_TEMPLATE = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your {{app}} licence key</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f6fa;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6fa;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #d8e4f0;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="background:#36494e;padding:24px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:14px;"><img src="cid:cliniciq-logo" alt="ClinicIQ Solutions" width="44" height="44" style="display:block;border:0;" /></td>
                    <td>
                      <div style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;">{{vendor}}</div>
                      <div style="margin-top:3px;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:12.5px;color:#a9cef4;">Licence delivery</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="height:3px;background:#c4a661;" height="3">&nbsp;</td></tr>
            <tr>
              <td style="padding:32px 36px 0;">
                <h1 style="margin:0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:21px;font-weight:700;letter-spacing:-0.01em;color:#36494e;">Your {{app}} licence key</h1>
                <p style="margin:14px 0 0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14.5px;line-height:1.6;color:#1a1d20;">Hi {{name}},</p>
                <p style="margin:10px 0 0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14.5px;line-height:1.6;color:#1a1d20;">Thank you for your purchase. Here is the licence key for {{app}}; it unlocks {{seats_label}} and is valid until {{expiry}}.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 36px 0;">
                <div style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#597081;">Licence key</div>
                <div style="margin-top:8px;padding:14px 16px;background:#eef3f8;border:1px solid #d8e4f0;border-left:3px solid #c4a661;border-radius:10px;font-family:ui-monospace, 'SF Mono', Menlo, Consolas, monospace;font-size:13px;line-height:1.6;color:#36494e;word-break:break-all;">{{key}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 36px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #d8e4f0;">
                  <tr>
                    <td style="padding:9px 0;width:40%;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;color:#597081;">Product</td>
                    <td align="right" style="padding:9px 0;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;font-weight:600;color:#1a1d20;">{{app}}</td>
                  </tr>
                  <tr>
                    <td style="padding:9px 0;width:40%;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;color:#597081;">Licensed to</td>
                    <td align="right" style="padding:9px 0;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;font-weight:600;color:#1a1d20;">{{name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:9px 0;width:40%;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;color:#597081;">Tier</td>
                    <td align="right" style="padding:9px 0;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;font-weight:600;color:#1a1d20;">{{tier}}</td>
                  </tr>
                  <tr>
                    <td style="padding:9px 0;width:40%;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;color:#597081;">Seats</td>
                    <td align="right" style="padding:9px 0;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;font-weight:600;color:#1a1d20;">{{seats}}</td>
                  </tr>
                  <tr>
                    <td style="padding:9px 0;width:40%;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;color:#597081;">Valid until</td>
                    <td align="right" style="padding:9px 0;border-bottom:1px solid #d8e4f0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:13px;font-weight:600;color:#1a1d20;">{{expiry}}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 36px 0;">
                <p style="margin:0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;color:#1a1d20;">To activate, open {{app}} and paste the key when prompted. Activation needs a one-time internet connection; after that {{app}} runs fully offline for the licence term. Line breaks from email wrapping are fine.</p>
                <p style="margin:10px 0 28px;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;color:#1a1d20;">Questions? Just reply to this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 36px 30px;border-top:1px solid #d8e4f0;">
                <p style="margin:0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:#597081;">This key is licensed to the named business only.</p>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:11.5px;color:#597081;">© {{year}} {{vendor}}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

/** The delivery email: key, term, and how to activate. Plain text + HTML. */
export function buildEmail({ practice, tier, seats, key, expiresAt }) {
  const expiry = formatDateAU(expiresAt);
  const tierLabel = tier ? tier[0].toUpperCase() + tier.slice(1) : '—';
  const subject = `Your Camog licence key (${practice})`;
  const values = {
    app: 'Camog',
    name: escapeHtml(practice),
    tier: escapeHtml(tierLabel),
    seats: String(seats),
    seats_label: `${seats} seat${seats === 1 ? '' : 's'}`,
    expiry,
    key: escapeHtml(key),
    vendor: 'ClinicIQ Solutions',
    year: String(new Date().getFullYear()),
  };
  const html = fillTemplate(LICENCE_EMAIL_TEMPLATE, values);
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
  return { subject, text, html };
}
