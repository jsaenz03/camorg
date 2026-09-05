# Camog security notes — the phone link

Plain-language notes for practice IT reviewers on how the phone (companion)
link works, what protects it, and what it deliberately does not do. Current
as of Camog 0.4.7+.

## What the link is

While a phone link session is open, the app runs a small HTTP server on the
clinician's computer (a pinned port in the unprivileged range, bound to all
interfaces so it survives Wi-Fi ↔ hotspot switches). The phone opens a
pairing URL — `http://<address>:<port>/t/<code>/` — scanned from a QR shown
in the app. The app opens no router ports, installs no VPN software, and
contacts no external service: if the phone can reach the computer's address,
the link works; otherwise it does not.

## Access control

- **Pairing code.** A 64-bit random hex code in the URL path is the only
  credential. Requests without it get the same 404 as any unknown route —
  the code's existence is not observable. The code persists across restarts
  so a phone's saved home-screen icon keeps working.
- **Code rotation.** *New code* in the phone link dialog revokes the current
  code immediately (the old URL stops working the moment it is pressed) and
  mints a fresh one on the same address. Use it whenever a code may have
  been shared, photographed or left in a browser history. The action is
  recorded in the audit log.
- **Throttling.** Wrong-code requests are counted per source address: ten
  failures inside a minute pauses that address for five minutes (answered
  with the same 404). A request presenting the valid code always gets
  through, so a re-scanned phone reconnects instantly.
- **Logging.** Every rejected request is noted in Settings → Diagnostics
  with the source address only — never the requested URL, which could
  contain a guessed or leaked code fragment.
- **Least data.** The phone only ever sees the access-filtered patient and
  photo list the signed-in clinician can already see, and photo bytes are
  served from an explicit filename whitelist — the listener itself has no
  database access. Requests made without the clinician's knowledge cannot
  exceed that surface.
- **Idle close.** A link with no phone traffic for 30 minutes ends itself.

## Encryption

- **At rest:** photographs and thumbnails are AES-256-GCM encrypted on disk;
  the key lives in an owner-only photo-key file in the app data directory
  (cameras first launched on 0.4.6 or earlier have their key moved out of
  the OS credential store once, automatically). The database, backups,
  result files and report PDFs are not encrypted at rest — protect the
  machine and its backups accordingly.
- **In transit:** the link is plain HTTP — a deliberate trade-off, because
  certificates cannot be issued for LAN addresses without installing a
  private CA on every phone. On the same Wi-Fi this exposes photo traffic to
  other devices on that network; the mitigations below bound who can reach
  the link at all. Over Tailscale (see below) the tunnel encrypts
  everything. End the session when it is not needed.

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
