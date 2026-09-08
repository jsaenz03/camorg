# Camog legal documents

- `terms-of-service.md` — Terms of Service (software licence) for organisations installing Camog.
- `privacy-policy.md` — Privacy Policy (APP-aligned; Part A covers the supplier, Part B covers how the app handles patient information and the practice's obligations).
- `security-notes.md` — plain-language security notes on the phone link for practice IT reviewers (pairing-code exchange + session cookies, rotation, throttling, encryption at rest/in transit, firewall scoping, off-site use).

## Shipping without lawyer review — still to confirm when a lawyer is engaged

Supplier details are completed from the ClinicIQ business records (ABN 55 882 511 758,
Wollongong NSW): entity + trading name, ABN, address, support/privacy contacts,
distribution channels (Microsoft Store + https://camog-license.cliniciq.com.au, ToS cl 9.1/18),
commercial model (ToS cl 3.1–3.2 — 14-day trial, then a licence key with a device-seat
count, activated once online against the activation server per
specs/003-licence-activation), governing law (New South Wales, ToS cl 16).

Still to confirm with the lawyer:

1. Liability cap amount (ToS cl 12.3 — currently AUD $100 / fees paid, a common
   no-fee-software formulation; confirm it suits ClinicIQ's risk position).
2. Whether any fees will be charged for licence keys (amend cl 3.2 if so).
3. The seat-move commitment (ToS cl 3.2 promises a support-request seat move to a
   replacement computer; confirm no SLA wording is needed).
4. Activation-record retention (Privacy cl 5 — licence term + 12 months, then
   deletion; confirm it suits ClinicIQ's support needs).

## Also do

- Have a qualified Australian lawyer review both documents when practical — the Microsoft Store release ships them without legal review.
- Keep the documents accurate to the code (v1.3, with spec 003): the only outbound
  connection the app ever makes is the **one-time licence activation check**
  (licence key + random device identifier only — never patient information, no
  telemetry, no analytics, no cloud backend, no automatic updater, plain-HTTP LAN
  phone tether); photographs, thumbnails and result files **are** encrypted at rest
  (AES-256-GCM, key in an owner-only photo-key file in the app data directory),
  backups are **passphrase-encrypted** (practice-chosen passphrase per backup; not
  recoverable if lost), while the **database and exported report PDFs are not**
  encrypted. If any of that changes, update the documents with the release that
  changes it — and re-sync all three copies (public/legal for the in-app page,
  activation-server/public/legal for the public Store-listing URLs; CI checks both).
- Direct-download installers are unsigned until Apple notarisation; ToS cl 10
  states this. When the app is signed, update cl 10 and MACOS_GUIDE.md in the same release.
