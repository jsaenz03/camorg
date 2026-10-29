# Spec 007 — QR-keyed transit encryption for the phone link

Approved 30 Oct 2026. Ship as **0.13.0** (after 006; its own bake).

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
