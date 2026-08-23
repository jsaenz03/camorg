# 002 — Offline Licence

## Problem

Camog is a fully local Tauri desktop app (SQLite per machine, no server). It
needs a licensing scheme that can be sold per practice without any hosted
infrastructure, and that never blocks a clinic from viewing existing patient
records.

## Decisions

- **Commercial model**: per-practice subscription; tier (`solo`/`practice`/
  `clinic`), seat count, and expiry ride inside a signed payload. Nothing is
  enforced server-side (there is no server); seats are honour-system until a
  future activation endpoint exists (phase 2, if ever needed).
- **Enforcement unit**: the install (machine). Each install stores its own
  licence in its own SQLite settings row.
- **Trial**: 14 days from first launch, stamped lazily on the first
  `getStatus()` call.
- **After trial / on expiry**: READ-ONLY mode — patients and photos stay
  viewable and exportable (records retention), capture and editing are gated.
- **Crypto**: Ed25519 via `@noble/ed25519` (pure JS — WebKit/WebView2 WebCrypto
  Ed25519 support is unreliable). Private key lives in `.keys/` (gitignored),
  public key is embedded in `lib/licence/public-key.ts`.
- **Clock**: trusts `Date.now()` (same as sessions). No rollback detection.

## Key format

`base64url(payloadJSON) . base64url(signature)` where payload is
`{ v: 1, practice, tier, seats, issuedAt, expiresAt }` (unix ms). Whitespace
in pasted keys is stripped before parsing.

## Components

| Piece | Location |
|---|---|
| Contract | `contracts/licence-service.ts` (`ILicenceService`, `LicenceStatus`) |
| Verification | `lib/licence/verify.ts` |
| Vendor public key | `lib/licence/public-key.ts` |
| Service | `lib/services/licence-service.ts` |
| React context | `lib/licence/licence-context.tsx` (root layout) + activation dialog |
| Banner | `components/licence/licence-banner.tsx` |
| Read-only gates | capture page, patient create/edit, photo delete, annotation save |
| Settings | Settings → Licence (admin): details + change key |
| Keygen | `scripts/licence-keygen.mjs` (`genkeys` / `issue` / `selftest`) |
| Storage | `settings.licence_key`, `settings.trial_started_at`, `settings.install_id` (migration 008) |

## Enforcement ceiling

UI-level gating deters honest users only — the DB and key are local and
editable by the machine's owner. Never lock records viewing behind the
licence (clinical retention); only write paths are gated.
