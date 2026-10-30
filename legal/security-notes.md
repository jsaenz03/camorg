# Camog security notes — the phone link

Plain-language notes for practice IT reviewers on how the phone (companion)
link works, what protects it, and what it deliberately does not do. Current
as of Camog 0.13.4.

## What the link is

While a phone link session is open, the app runs a small HTTP server on the
clinician's computer (a pinned port in the unprivileged range, bound to all
interfaces so it survives Wi-Fi ↔ hotspot switches). The phone opens a
pairing URL — `http://<address>:<port>/t/<code>/` — scanned from a QR shown
in the app. The app opens no router ports, installs no VPN software, and
contacts no external service: if the phone can reach the computer's address,
the link works; otherwise it does not.

## Access control

- **Pairing code + transit key (exchange credentials).** A 64-bit random hex
  code in the QR's URL path, travelling with a 256-bit transit encryption
  key (the QR's `?k=` value) that seals every patient-data record on the
  link (see *In transit*). Opening the URL once exchanges the code for a
  per-device session cookie and stores the transit key; every later request
  authenticates by that cookie, so the long-lived code and key no longer
  ride in the URL of each request. Requests without a valid code or cookie
  get the same 404 page as any unknown route — neither the code, the key nor
  the sessions are observable. The code and key persist across restarts and
  rotate together — *New code*, or a different clinician signing in —
  instantly invalidating every previously saved link. Keys are stored per
  origin (a phone pairing over both Wi-Fi and Tailscale scans each QR once),
  and a phone that saves the link to its home screen keeps its copy of the
  key in that phone's own browser storage — treat a paired phone as holding
  a live credential.
- **Session cookie.** A 128-bit random value, HttpOnly (invisible to page
  scripts), SameSite=Strict, session-scoped (no expiry — it dies with the
  browser session). Sessions live in the app's memory only: ending the link
  — *End session*, an app restart, or the 30-minute idle close — signs out
  every paired phone at once, without rotating the code. Phones recover by
  re-running the exchange from their saved URL; a page left open on a phone
  whose cookie has died shows the re-connect page, which accepts the current
  link address pasted from the desktop dialog. A leaked pairing code
  still pairs until rotated — that has not changed; what has changed is that
  the code crosses the network once per pairing instead of per request, and
  sessions can be revoked server-side.
- **Code rotation.** *New code* in the phone link dialog revokes the current
  code immediately (the old URL stops working the moment it is pressed),
  signs out every paired phone, and mints a fresh one on the same address.
  Use it whenever a code may have been shared, photographed or left in a
  browser history. The action is recorded in the audit log.
- **Throttling.** Requests without a valid code or session are counted per
  source address: ten failures inside a minute pauses that address for five
  minutes (answered with the same 404). A request presenting a valid
  credential — the live code or a live session cookie — always gets
  through, so a re-scanned phone reconnects instantly.
- **Logging.** Every rejected request is noted in Settings → Diagnostics
  with the source address only — never the requested URL or cookie value,
  either of which could contain a guessed or leaked secret fragment.
- **Least data.** The phone only ever sees the access-filtered patient and
  photo list the signed-in clinician can already see, and photo bytes are
  served from an explicit filename whitelist — the listener itself has no
  database access. Requests made without the clinician's knowledge cannot
  exceed that surface.
- **Idle close.** A link with no phone traffic for 30 minutes ends itself
  (which also ends every phone's pairing for that link).

## Encryption

- **At rest:** photographs, thumbnails and attached result files (pathology
  PDFs, referral letters, …) are AES-256-GCM encrypted on disk; the key lives
  in an owner-only photo-key file in the app data directory (cameras first
  launched on 0.4.6 or earlier have their key moved out of the OS credential
  store once, automatically). Database backups are encrypted with a
  passphrase the practice chooses at each backup — the passphrase travels
  with the backup, so a restore works on any machine, and a lost passphrase
  means the backup cannot be opened. The live database and exported report
  PDFs are not encrypted at rest — protect the machine accordingly.
- **In transit:** the link runs over plain HTTP — still a deliberate
  trade-off, because certificates cannot be issued for LAN addresses without
  installing a private CA on every phone — but since Camog 0.13 every
  patient-data record that crosses it (photographs, reports, the pages the
  phone renders) is sealed with **AES-256-GCM** under the transit key
  exchanged at pairing, and the server rejects patient-data requests that do
  not carry a valid envelope. What an attacker who can sniff the traffic can
  still see: the one-off pairing exchange (the code and the transit key
  itself), the session cookie, and request metadata — which pages the phone
  asks for and how much data moves. Capturing the code, the key or the
  cookie is the real risk, and Tailscale remains the answer there: over the
  tunnel everything, including the pairing exchange, is encrypted.
  End the session when it is not needed.

## Network reach (the part IT controls)

- **Windows:** the NSIS installer (`.exe`) adds a program-scoped inbound
  firewall rule allowing the link **only from the local subnet and
  Tailscale's CGNAT range (100.64.0.0/10)** — devices on other networks,
  including a mis-bridged guest VLAN, cannot connect. This needs one UAC
  approval during install; declining it leaves Windows' standard "allow
  this app" prompt on first use, which permits the network profile the user
  chooses. The equivalent rule can be added manually:

  ```powershell
  New-NetFirewallRule -DisplayName 'Camog phone link' -Direction Inbound `
    -Action Allow -Program '<install path>\Camog.exe' -Protocol TCP `
    -RemoteAddress LocalSubnet,100.64.0.0/10
  ```

  The MSI installer does not add this rule.
- **macOS:** the application firewall is per-app (allow/deny) with no
  subnet scoping; the link is reachable from any network the Mac is joined
  to. Prefer running Camog on a consultation-room network that guest Wi-Fi
  cannot reach.
- **Off-site use:** nothing is configured per user. If the machine already
  runs Tailscale, the app detects it and offers a second QR that pairs from
  anywhere over the encrypted tunnel, governed by the tailnet's own access
  rules. Camog never installs or configures a VPN.

## Recommendations for practices

1. Keep clinical machines on a wired or staff-only Wi-Fi VLAN, with guest
   Wi-Fi properly separated.
2. Treat the pairing code like a password: rotate it (New code) if it may
   have been seen, and end the session at the end of the consult.
3. If remote access is needed, prefer Tailscale (or the practice's existing
   managed VPN with equivalent routing) over any port forwarding.
4. Review Settings → Diagnostics for `Rejected a request` / `Paused
   requests` entries when auditing unusual network activity.
