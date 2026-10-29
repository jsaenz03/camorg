# Camog — practice IT responsibilities

Updated: 29 October 2026 (v0.11.0)

Camog keeps patient records on the practice's own machines by design — there is
no cloud copy to lean on, so a small number of device-level responsibilities sit
with the practice rather than the software. This note lists them for IT
handover folders, risk registers and accreditation files.

## 1. Disk encryption is load-bearing (do this first)

Photos are encrypted by Camog itself (AES-256-GCM, key held in the operating
system's credential store), but the patient database — names, details, consent
records — is protected by the volume it sits on. On a workstation whose system
disk is not encrypted, a loss or theft is a notifiable data breach under the
Notifiable Data Breaches scheme.

- **Windows**: turn on BitLocker for the system drive (`manage-bde -on C:`,
  or Settings → Privacy & security → Device encryption on hardware that
  supports it).
- **macOS**: turn on FileVault (System Settings → Privacy & Security).

Camog checks this at startup: an unencrypted volume raises a warning banner
above the dashboard, and Settings → Diagnostics shows the current state
("Disk encryption"). On Windows Home edition Camog cannot read the status
without admin rights — it says so and points at Settings → Privacy & security
→ Device encryption (full BitLocker requires Windows Pro). The app warns; it
deliberately never blocks — enforcing device policy is the practice's
decision, not the software's.

## 2. Physical security of the vault machine

Local-first makes the Camog workstation the vault. Screen locking, Camog's
idle privacy lock (Settings → App settings), and who can sign in to the
computer at all are practice controls — the app inherits all of them.

## 3. The phone link is a LAN service, and it is opt-in

While in use, the PC listens on the practice network for a paired phone (plain
HTTP, gated by a pairing code; see the phone-link answers in
`camog-it-qa.pdf` for the full picture). From v0.11.0 the link does **not**
start on its own: nothing listens until the clinician opens the phone link or
turns "Start automatically" on in the link dialog. The Windows installer adds
a firewall rule ("Camog phone link") that permits inbound from the local
subnet and Tailscale ranges on **any** network profile, so it works whether
Windows classifies the network Private or Public; machines missing that rule
(Store installs, or a declined elevation prompt) can be fixed with
`installers/repair-phone-link-firewall.ps1` (run once, as administrator).

Use it on a trusted practice network (or over Tailscale); avoid guest or flat
networks. Ending the session signs paired phones out. The listener also closes
itself after 30 minutes of inactivity, and signing out of Camog ends it.

## 4. Backups extend trust to their destination

Automatic backups are encrypted before they leave the machine (passphrase held
in the OS credential store, never in the database), but the destination folder
is the practice's choice. Pointing backups at a OneDrive or Dropbox folder
extends trust to that sync account and its history — a deliberate decision an
IT contact should make, not a default.

## 5. Updates (automatic on Windows, from 0.12.0)

Camog 0.12.0 and newer checks a signature-verified update channel on Windows:
once a day at launch, and on demand from Settings → Diagnostics → Check for
updates. A new version is downloaded, checked against the publisher's signing
key and installed only when someone clicks Install — never silently — and the
restart that finishes it is a separate click. Machines can therefore stay
current without a per-machine reinstall.

Install-type notes:

- **Microsoft Store installs** never use the channel — the Store manages
  those updates itself (Camog detects the Store install and skips checking).
- **NSIS installer installs** (`Camog_..._x64-setup.exe`) update
  automatically through the channel.
- **WiX MSI installs** (`Camog_..._x64_en-US.msi`) are not updated by the
  channel — the updater serves the NSIS payload, so an MSI machine keeps
  updating manually (reinstall over the top; data lives in the app data
  folder and survives). Prefer the NSIS installer for new direct installs.
- **macOS** has no update channel yet (the builds are not Developer-ID
  signed/notarised) — update by downloading the new DMG.

A machine holding health information should still be on the same patch
cadence as the rest of the fleet: the channel reaches direct Windows
installs automatically, but a machine that rarely opens Camog only checks
when it does.
