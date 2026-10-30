# Spec 007 — QR-keyed transit encryption for the phone link

Approved 30 Oct 2026. **Shipped as 0.13.0** (30 Oct 2026).

## What shipped

- **Key exchange rides the QR**: pairing URLs now end in `?k=<base64url 32
  bytes>` on both the LAN and Tailscale QRs (the envelope is orthogonal to
  the path; the discovery probes, bind, port and token mechanics are
  untouched). The key persists beside the token as `phone-link-key`
  (owner-only, hex), minted on demand for installs that paired before
  0.13.0; `reset_pairing_token` (the dialog's "New code" AND the
  account-switch rotation) deletes and re-mints it. The exchange's 303
  carries the query into `/?k=…` once; the page stores the key in
  localStorage (`camog-link-key`) so saved home-screen icons keep
  decrypting. The server never serves the key.
- **Envelope**: AES-256-GCM, `nonce(12) ‖ ciphertext‖tag` (the aes-gcm
  crate's native layout), random 96-bit nonce per record. Encrypted:
  library manifest, `img/*` bytes, case-report PDF down; photo uploads and
  the `photo-review`/`report-request` JSON bodies up. Plaintext (per the
  design): pairing handshake, `hello`/`link-code`, `library-wait`
  (`{changed:…}` carries no patient data), logo/manifest static assets.
- **Downgrade rules**: sensitive downloads are ALWAYS enveloped — no
  plaintext fallback on the desktop. Uploads open enveloped bodies when the
  `X-Link-Envelope: 1` header is present and pass plaintext through (a
  stale cached page finishes its life capture-only); corrupt envelopes get
  400, never a guess. A GET `/hello` without the `X-Link-Key: 1` capability
  marker gets the dead-pairing 404 — which old cached pages already render
  as the re-scan message, satisfying the version-skew requirement without
  any raw error. In-page, an undecryptable record routes to the same
  re-scan UX (`envelopeFailed`), and a live session with a stale key marks
  the self-heal hop spent so it can't ping-pong.
- **Rust tests** (100 green): envelope round-trip / wrong-key / tamper /
  nonce-freshness / truncation; an 8 MB seal+open benchmark; key-file shape;
  and three live-socket integration tests — the passive-capture equivalent
  (raw transcript of a full session searched for the patient's name, the
  manifest JSON and recognisable JPEG runs — nothing in the clear),
  envelope upload acceptance + tampered/wrong-key refusal + plaintext
  fallback, and the long-poll waking with the manifest verified to decrypt
  exactly. `pairing_urls` tests assert the `?k=` suffix on both URL kinds.
- **Phone page**: an embedded pure-JS AES-256-GCM (see deviation 1) whose
  byte layout matches the Rust side, cross-verified against Node's OpenSSL
  in `scripts/self-check-phone-crypto.mjs` (both directions, tamper,
  wrong-key, truncation, determinism, 8 MB timing). `check-phone-page.mjs`
  now drives the whole flow through OpenSSL-sealed manifests/photos/reports
  and sealed uploads (65 checks green) — including wire assertions that
  photos arrive sealed and decrypt to real JPEGs.
- The camera `<input capture>` flow, pairing UX, idle close, POST meter,
  AuthGuard and the Tailscale path behave exactly as before (`git diff`
  shows the discovery/bind functions untouched; only `pairing_urls` gained
  the `?k=` suffix).

## Deviations (both forced by the platform, flagged during implementation)

1. **No WebCrypto — an embedded JS AES-256-GCM instead.** The spec's
   "Phone side: WebCrypto (AES-GCM is universal)" is not implementable on
   this link: `crypto.subtle` is secure-context-only, and every non-
   localhost phone-link address (LAN IP, phone hotspot, Tailscale 100.x) is
   plain HTTP, where `crypto.subtle` is undefined. The page embeds a
   compact AES-256-GCM (S-box generated, not tabulated; GHASH via 16×256
   precomputed products so an 8 MB photo hashes in well under a second).
   Correctness is not taken on trust: the self-check extracts the marked
   `gcm` block and cross-verifies it against OpenSSL both ways, and the
   phone-page check drives the real page against OpenSSL-sealed data.
   Performance, measured: ~760 KB shrunk snaps seal in tens of
   milliseconds; the 8 MB worst case is ~0.7 s in Node (the Rust side does
   the same record in tens of milliseconds) — the regression-watch
   benchmark lives in both test suites.
2. **No service worker — the shell revalidates by ETag instead.** Service
   workers are likewise secure-context-only; registration would silently
   fail on every plain-HTTP address, so "cache-first after first load" as
   written cannot exist on this link. Same mitigation, honest mechanism:
   the shell serves `Cache-Control: no-cache` plus a version ETag
   (`camog-page-<version>`), so loads revalidate — a 304 carries no bytes,
   the page's JS rides the wire only when the app actually changed, and
   stale-page skew (old cached page vs new server) is impossible by
   construction. The documented residual window stands: the shell still
   arrives over HTTP the first time (and whenever it actually changes);
   everything patient-related is enveloped from the first byte.

Also fixed while here: the request handler's eight loose parameters became
a `LinkContext` struct to keep clippy green, and the report download's
`Content-Disposition` header went with the plaintext route it served.

**0.13.2 follow-up (30 Oct, field report):** a phone paired before 0.13.0
opening its saved link (over Tailscale or LAN) connects but cannot decrypt
— the key only travels on the QR — so it lands on the keyless-page 404.
That is the designed skew path, but the page's generic "Pairing expired"
copy read as "broken" (the user's exact report: "says not found"). Now a
keyless page (no stored key at all) shows "Camog was updated — scan the QR
in Camog's Phone link dialog once…" and skips the futile self-heal hop;
the pre-envelope upgrade flow is pinned end to end by
`pre_envelope_phone_upgrade_flow` (saved icon still exchanges → keyless
hello 404 → one `?k=` scan → fully live session). Note the key is stored
per phone origin, so a phone that uses BOTH paths scans each QR once.

## Problem

Phone-link traffic crosses the LAN as plaintext: the photo-library manifest
(patient names, IDs), photo bytes down, snapped photos up. The firewall rule
permits the local subnet on any network profile by deliberate choice
(ecb4367), so the transit edge is covered only by "the practice LAN is
trusted". Tailscale connections are already tunnel-encrypted and **must not
change** — this spec layers on top, orthogonally to which address the phone
uses.

## Design (approved — implement as written; flag deviations before coding)

1. **Key exchange rides the QR, which is a physically authenticated
   channel**: the phone scans it live off the desktop screen, so an on-path
   attacker cannot tamper with it. Extend the pairing URL with a random
   256-bit key (base64url). The existing pairing-code rotation
   (`reset_pairing_token`, account-switch rotation) rotates the key too.
2. **Envelope**: AES-256-GCM (`aes-gcm` is already a dependency) with random
   96-bit nonces per record. Encrypted: library manifest, photo bytes
   (down), snapped/result payloads (up). Never encrypted: the pairing
   handshake itself and static assets (they carry no patient data).
3. **Phone side**: WebCrypto (AES-GCM is universal). The key comes from the
   scanned URL; sessions persisted on the phone keep working across
   restarts as today.
4. **App-shell caveat (state it in the dialog copy)**: the phone page's JS
   still arrives over HTTP on first load. Mitigate by making the PWA
   service worker cache-first after first successful authenticated load so
   later loads don't refetch the shell over HTTP. Residual window =
   first pairing on a hostile network; documented, accepted. Upgrade path:
   Tailscale HTTPS certificates (separate future spec).
5. **Version skew**: an old phone page that receives an envelope it can't
   read must show the re-scan message (same UX as a rotated code), never a
   raw error. Key presence in the URL is the capability signal.

## Acceptance

- Passive-capture test: record LAN traffic during a session (tcpdump/Wireshark
  on the desktop side), assert no patient names or JPEG bytes appear in
  plaintext.
- Tamper test: flipping one ciphertext byte rejects the record (GCM auth).
- Rust tests: envelope round-trip, wrong-key rejection, nonce uniqueness.
- All existing `remote_camera.rs` HTTP tests updated for the envelope (they
  drive `handle_request` with raw bodies — plan the test-key plumbing
  first).
- The camera `<input capture>` flow, pairing UX, idle close, and the
  Tailscale path behave exactly as before.
- `scripts/self-check-phone-tether.mjs` needles updated (known CI flake:
  `check-phone-page` occasionally needs a rerun).

## Regression watch

- Envelope cost on 4–8 MB JPEGs is negligible (GCM ~GB/s) but benchmark the
  photo upload once.
- Do not change the listener's bind/port/token mechanics in this spec.
