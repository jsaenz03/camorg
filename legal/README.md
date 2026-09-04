# Camog legal documents

- `terms-of-service.md` — Terms of Service (software licence) for organisations installing Camog.
- `privacy-policy.md` — Privacy Policy (APP-aligned; Part A covers the supplier, Part B covers how the app handles patient information and the practice's obligations).

## Before publishing — have a qualified Australian lawyer review both documents

Supplier details are completed from the ClinicIQ business records (ABN 55 882 511 758,
Wollongong NSW): entity + trading name, ABN, address, support/privacy contacts,
distribution URL, commercial model (ToS cl 3.2 — 14-day trial then licence key,
matching the code), governing law (New South Wales, ToS cl 16).

Still to confirm with the lawyer:

1. Liability cap amount (ToS cl 12.3 — currently AUD $100 / fees paid, a common
   no-fee-software formulation; confirm it suits ClinicIQ's risk position).
2. Whether any fees will be charged for licence keys (amend cl 3.2 if so).

## Also do

- Have a qualified Australian lawyer review both documents — they are drafts, not legal advice.
- Keep the documents accurate to the code: they state there is **no telemetry, no cloud backend, no automatic updater, and plain-HTTP LAN phone tether**; photographs and thumbnails **are** encrypted at rest (AES-256-GCM, key in the OS credential store) while the **database, backups, result files and report PDFs are not**. If any of that changes, update the documents with the release that changes it.
- Consider surfacing both documents in-app (e.g. a link in Settings) and at the distribution page.
