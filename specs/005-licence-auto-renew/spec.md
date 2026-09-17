# Spec 005 — Licence auto-renew

Automates renewal for subscription buyers: each successful payment extends
the licence with no service disruption and no manual key entry. Supersedes
the "deferred until wanted" bullet in spec 004's decisions — that spec's
one-off purchase flow is unchanged and stays the only path for buyers who
did not subscribe. Status: implemented.

## Decisions

- **Renewal is a fresh signed key, minted by the existing worker.** The key
  payload's `expiresAt` is immutable, so "extending" means minting a
  successor (same practice/tier/seats, new 12-month term from the payment
  date). Stripe's `invoice.paid` (billing_reason `subscription_cycle`) is
  the trigger; `extractRenewal` (fulfil.mjs) gates on it so the
  subscription's first invoice never double-mints — the origin purchase
  still belongs to `checkout.session.completed`, which now also records
  `session.subscription` as the chain anchor.
- **Renewal keys chain in D1, not in the key payload.** `licences.renews_fp`
  names the predecessor's fingerprint; the chain tip is the newest
  successfully minted key under a `subscription_id`. Rows are keyed on the
  invoice id, so webhook retries are idempotent (same pattern as spec 004's
  session id).
- **The successor rides the daily seat re-check.** `/v1/validate` returns
  `renewal` (the successor key text) alongside the seat verdict — no new
  endpoint, no push channel, and the app needs no new network path (the
  same Rust-transported HTTPS call to the licence host it already makes). Only a device
  holding an unrevoked seat on the predecessor ever sees the successor, and
  the same key was emailed to the buyer anyway — nothing new leaks. Seat
  checks run BEFORE the expiry verdict: a revoked seat must not collect its
  successor even after the old key lapsed.
- **The app installs it through the ordinary activation path.** With the
  setting on, `validateWithServer` feeds the successor to `activate()` —
  signature, server token and device binding are all re-verified exactly as
  for a pasted key — then records `licence.renewal` in the audit trail.
  Failure is transient by definition (the offer stays on the server;
  tomorrow's check retries). Auto-renew defaults to ON (migration 023):
  renewal after payment should be invisible. The toggle governs the app
  only — billing lives in Stripe, and the app never talks to Stripe.
- **Expired-with-paid-successor recovers silently.** For an expired
  presented key with an unexpired successor, validate answers 200 with the
  renewal instead of 410, so an install that was offline through its expiry
  (payment landing during the gap) comes back valid on its first online
  open. Without a successor, the existing 410 → read-only flow stands.

## Flow

1. Buyer subscribes on `/buy` through a subscription-mode Payment Link
   (same `tier`/`seats` metadata and optional practice field as spec 004).
2. `checkout.session.completed` mints K1 exactly as spec 004 and records
   the subscription id.
3. ~12 months later Stripe charges the card; `invoice.paid`
   (subscription_cycle) mints K2 from the chain tip, emails it (the buyer's
   off-app record and the fallback when auto-renew is off), records it with
   `renews_fp = fp(K1)`.
4. The app's at-most-daily seat re-check presents K1; validate finds the
   successor and returns it; the app (auto-renew on) activates K2. In
   Settings → Licence only the "Expires" date has moved.
5. Failure modes: payment fails → no successor → K1 runs to natural expiry
   → read-only (existing flow); the subscription lapses in Stripe dunning →
   same; auto-renew off → the emailed key is pasted manually (spec 003).

## Surfaces touched

- activation-server: `schema.sql` (+`subscription_id`, `renews_fp`),
  `fulfil.mjs` (`extractRenewal`), `worker.mjs` (`invoice.paid` routing,
  `fulfilRenewal`, shared `deliverKey`, validate `renewal` field).
- src-tauri: `validate_licence` returns `Ok(Option<String>)` — the seat
  verdict plus the successor key when one is waiting; migration
  `023_licence_auto_renew.sql`.
- app: `LicenceStatus.autoRenew`, `ILicenceService.setAutoRenew`,
  renewal install in `validateWithServer`, Auto-renew switch in
  Settings → Licence, audit actions `licence.renewal` / `licence.auto-renew`.

## Runbook deltas

See activation-server/README.md (automated fulfilment section): create
subscription-mode Payment Links alongside the one-off ones and paste them
over the `STRIPE_SUBSCRIPTION_LINK` placeholders on `/buy`, add
`invoice.paid` to the webhook endpoint's subscribed events, and ALTER the
existing D1 `licences` table. Support notes: cancel/refund in Stripe as
usual; renewal rows are retrievable with `GET /v1/licences?session=<invoice
id>`, and following `renews_fp` from any key the buyer quotes walks to the
current one.
