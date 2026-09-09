# Spec 004 — Licence purchase fulfilment

Automates the missing step of the licence pipeline: how a buyer gets a key.
002 defined the offline key format and 003 the activation server; this spec
covers purchase → key delivery → first activation. Status: implemented.

## Decisions

- **Fulfilment lives on the existing activation worker** (spec 003). It
  already verifies keys, already holds D1, already serves the public site.
  The signing half of `scripts/licence-keygen.mjs` is pure `@noble/ed25519`
  and ports to the worker as `issueLicence` — the webhook mints keys the app
  already verifies offline. No new hosting, no new deployment target.
- **Checkout is hosted by Stripe (Payment Links), never in the app.** The
  app's only purchase surface is a link to `https://camog-license.cliniciq.com.au/buy`
  (`lib/licence/buy-url.ts`) opened in the system browser from the activation
  dialog, the trial/read-only banners and Settings → Licence. This keeps the
  product's outbound-connection claim intact (the app still makes exactly
  one network call: activation) and keeps the web view free of payments.
- **One-time annual term licences, not Stripe subscriptions.** The key
  payload's `expiresAt` is the term; renewal = repurchase + activate the new
  key (the renewal banner points at the same dialog/buy page). Auto-renewal
  would need an `invoice.paid` re-issue flow — deferred until wanted.
- **Email is the delivery channel** (Resend HTTP API — Workers cannot do
  SMTP; the Resend account already sends as licences@cliniciq.com.au). The
  key is also recorded in D1, so support can always re-deliver.
- **Pricing** (AUD, per practice per year): Solo 1 seat A$179 ·
  Practice 3 seats A$399 · Clinic 10 seats A$799. Tier blocks with bundled
  seats (not per-seat maths) because tier/seats are single fields of the
  signed payload. Prices are page content, not code — changing them means
  editing the Payment Links and `public/buy.html` only.

## Flow

1. Buyer opens `/buy` (static `public/buy.html`) and pays on a Stripe
   Payment Link that carries metadata `tier` + `seats` and an optional
   "practice" custom field.
2. Stripe POSTs `checkout.session.completed` to `POST /webhooks/stripe`.
3. The worker verifies Stripe's signature (WebCrypto HMAC, 5-min tolerance,
   constant-time compare), extracts the order, signs a 12-month key with the
   `LICENCE_PRIVATE_KEY` secret, and self-verifies it with the same
   `verifyLicence` path activation uses.
4. The key is inserted into the D1 `licences` table keyed on the Stripe
   session id (webhook retries are idempotent), then emailed. `emailed_at`
   stays NULL until Resend accepts, so a retry re-attempts delivery instead
   of minting a second key.
5. The buyer pastes the emailed key into the existing activation dialog;
   spec 003 takes over from there.

## Contract

- `POST /webhooks/stripe` — Stripe-signed events only (`bad_signature` 400).
  Handles `checkout.session.completed` and
  `checkout.session.async_payment_succeeded` with `payment_status: 'paid'`.
- `GET /v1/licences` (admin bearer) — `?session=` or `?fp=` returns the full
  record including the key; bare returns the latest 50 without keys.
- D1 `licences` row: `session_id` PK, `email`, `practice`, `tier`, `seats`,
  `key_text`, `key_fp`, `expires_at`, `issued_at`, `emailed_at`. `tier`
  NULL ⇒ metadata was missing/malformed: payment recorded, no key issued,
  support fulfils by hand (`runbook` section covers this and key re-sends).

## Ceilings (accepted)

- No refunds/chargeback automation — refunds are manual; a refunded key
  still works until term end unless support revokes seats (same ceiling as
  spec 003's soft revocation).
- Tier/seats come from Payment Link metadata, not a server-side price map —
  a misconfigured link produces a recorded-but-unfulfilled session, not a
  wrong key.
- The purchase record (billing email + practice name) is new personal
  information held by the Supplier; legal docs moved to v1.4 for it
  (privacy cl 4.5/5, ToS cl 7.5(c)).
