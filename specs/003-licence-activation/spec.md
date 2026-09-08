# 003 — Licence Activation (server-side seats)

## Problem

Spec 002 shipped seats as an honour system: the seat count rode in the signed
payload but nothing enforced it, so the same key activated unlimited machines.
Before the Microsoft Store release that becomes a real revenue leak, and it
cannot be fixed after keys are in customers' hands.

## Decisions

- **Enforcement point**: activation time, server-side. The app's ONE outbound
  call in the entire product is `POST /v1/activate` at activation (renewal is
  just another activation). Everything else — trial, expiry, read-only gating —
  stays fully on-device and offline.
- **Server**: Cloudflare Worker + D1 (`activation-server/`), plain JS modules
  so the self-check imports the real logic. Seat state is one table keyed by
  (licence fingerprint, device ID); revocation is soft (support-driven seat
  moves via `activation-server/scripts/seat-admin.mjs`).
- **Device binding**: the device ID lives in a `device-id` file under the
  user's home directory (`~/.camog/device-id`), deliberately OUTSIDE the app
  data directory the SQLite DB lives in. Copying app data to another machine
  therefore does not carry the seat: the new machine's ID differs, the stored
  token fails the match, and the app demands re-activation against the seat
  count. The OS credential store was considered and rejected on this project's
  own record — 0.4.6 kept the photo key there and the per-update access
  prompts read as invasive to clinicians (`photo_crypto.rs`). A home file
  prompts for nothing.
- **Activation token**: the server returns
  `base64url({v:1, fp, deviceId, exp}) . base64url(signature)` — same shape
  as licence keys, signed by the server's own Ed25519 key (public key
  embedded in `lib/licence/activation-public-key.ts`). `fp` is the SHA-256 of
  the stripped licence key; `exp` is the licence's expiry, so a token never
  outlives the licence it authorises. The client verifies the token before
  persisting anything and on every `getStatus()` — no network needed at
  launch.
- **Legacy keys** (activated before this feature): a stored key without a
  valid token falls through to trial/read-only; the banner asks for
  re-activation, which is the same key + one online check. Hard cut, no new
  UI state.
- **Failure mode**: activation with no internet fails with a clear message
  and nothing is stored; every other flow (trial, viewing, read-only) is
  unaffected. If the device file can't be used (no home dir, permissions),
  `device_id` falls back to the DB-stored install ID — degrading to the old
  DB-bound ceiling rather than breaking activation.
- **Clock**: still trusts `Date.now()` (spec 002). The token's `exp` equals
  the licence expiry, so token expiry adds no new clock trust.
- **Legal**: the ToS/Privacy "no outbound internet connections" claims were
  amended in the same release (v1.3): the activation check sends only the
  licence key and the device ID — never patient information.

## Flow

1. User pastes the key → client verifies the Ed25519 licence signature
   locally (instant, offline feedback on typos/forged keys).
2. Client invokes Rust `activate_licence(key, device_id)` → HTTPS POST of
   exactly those two fields to the worker.
3. Worker verifies the signature, rejects expired keys, counts non-revoked
   device IDs for the licence fingerprint: a known device may always
   re-activate; a new device needs `activeCount < seats`. On success it
   upserts the activation row and returns the signed token.
4. Client verifies the token against the embedded activation public key,
   checks fp + deviceId + exp, and only then persists key + token
   (`settings.licence_key`, `settings.licence_token` — migration 020) and
   writes the audit entry.
5. Every later launch: `getStatus()` verifies key + token locally. No
   network until the licence expires (renewal) or the user activates a new
   device.

## Components

| Piece | Location |
|---|---|
| Worker (routing + D1) | `activation-server/src/worker.mjs` |
| Pure activation logic | `activation-server/src/activation.mjs` (shared with the self-check) |
| Schema + deploy runbook | `activation-server/schema.sql`, `activation-server/README.md` |
| Seat admin CLI | `activation-server/scripts/seat-admin.mjs` (+ `gen-token-keys.mjs`) |
| Rust device ID | `src-tauri/src/licence_device.rs` (`device_id` command) |
| Rust activation call | `src-tauri/src/licence_activation.rs` (`activate_licence`, `ureq`) |
| Token verification | `lib/licence/verify.ts` (`verifyActivationToken`, `licenceFingerprint`) |
| Activation public key | `lib/licence/activation-public-key.ts` |
| Service wiring | `lib/services/licence-service.ts` (migration 020 adds `licence_token`) |
| Self-check | `scripts/self-check-licence-activation.mjs` |

## Enforcement ceiling

The server closes the "paste the same key everywhere" hole and the
"copy the app data folder" hole. Still true from spec 002: a determined
owner can patch the binary, roll the clock, or edit their local DB — no
client-side scheme prevents that. Known accepted residuals:

- A revoked device that already holds an unexpired token keeps working until
  the licence term ends (revocation bites at renewal).
- Two simultaneous first activations of the same key could overshoot its
  seats by one (count-then-insert is not serialised; requires possessing the
  secret key).
- Whole-machine migrations (e.g. Migration Assistant) copy the home
  directory too and read as the same device — which is the intended reading.
