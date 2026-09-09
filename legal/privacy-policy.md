# Camog Privacy Policy

**Effective date:** 09/09/2026 · **Version:** 1.4

---

## 1. Who we are

**John Raphael Saenz** (trading as **ClinicIQ Solutions**) ABN **55 882 511 758**, of **Wollongong NSW 2500, Australia** ("we", "us", "Supplier") is the supplier of the Camog clinical photo documentation software ("**Software**").

**Privacy contact:** privacy@cliniciq.com.au (Privacy Officer) · General enquiries: admin@cliniciq.com.au · https://cliniciq.com.au

## 2. At a glance

- Camog is a **local-first desktop application**. Patient records and photographs are stored in a database and image folder **on your own computer** (or a folder your organisation's administrator chooses).
- Apart from the **one-time licence activation check**, the Software **sends no information to us**. It has no telemetry, no analytics, no advertising tools, no crash reporting and no cloud backend. Its only outbound internet connection is the one-time licence activation check, which never includes patient information (see clauses 4.1 and 5).
- We never see, receive, host, back up or access your patients' information through the Software.
- If your administrator points the storage folder at a **cloud-synced folder** (OneDrive, Dropbox, iCloud or similar), your information may leave your computer through *that provider's* service — that is your organisation's choice and is not controlled by us or the Software (see clause 10).
- The **phone link** feature runs a small web server on your own computer so a paired phone on your network can send photos to it and — while the signed-in clinician has library sharing switched on — view the same patients and photographs that clinician can already see on the computer. Traffic between the phone and the computer is **unencrypted** (plain HTTP). Access is controlled by a random pairing code that is exchanged once for a per-device session cookie; unauthenticated requests are rate-limited and the link ends itself after 30 minutes of inactivity (see clause 8.3).
- The Software is **not connected to My Health Record** or any national e-health system.
- If you **buy a licence** through our website's checkout, we hold the billing email address and practice name you enter there to deliver the key and support the licence. Payment card details go to **Stripe** — we never see them (see clauses 4.5 and 5).

## 3. About this policy and who it protects

This policy has two parts:

- **Part A (clauses 4–5)** — the very limited personal information handled by us, the Supplier. This is the part that satisfies APP 1 of the *Privacy Act 1988* (Cth) for our own activities.
- **Part B (clauses 6–17)** — how the Camog Software collects, holds, uses and protects personal and health information **on behalf of the organisation that runs it**, and that organisation's obligations.

**Important for organisations using Camog:** if you are a health service provider (a practice, clinic or practitioner), **you are the APP entity** responsible for the patient information you record in Camog. This policy explains how the Software works but it does **not** replace your own APP 1 privacy policy and your APP 5 collection notices to patients. See clause 16.

## Part A — Personal information handled by the Supplier

## 4. What we collect and hold

**4.1 Through the Software: almost nothing.** In normal operation the Software collects no information for us. It has no telemetry, analytics, crash reporting, advertising integrations, or automatic update checks, and its web view is blocked from connecting to the internet. We do not receive your organisation's data, your users' account data, your patients' photographs, or any usage statistics. **The one exception is licence activation** (Terms of Service clause 3.2): when a licence key is activated, the Software sends the key and a random device identifier to our activation service. The key records the licensed practice's name and licence term; the device identifier is a random value unrelated to the device's serial number, user account or location.

**4.2 If you contact us** (for example, by emailing support), we hold the personal information you choose to give us, such as your name, email address, phone number, organisation name and the contents of your message (which may include information about patients if you include it — **please de-identify patient details before sending us anything**).

**4.3 Licence activation records.** When a licence key is activated, we hold a record binding the key's fingerprint (the key itself records the licensed practice's name and licence term) to the random device identifier, with activation timestamps. It contains no patient information and no information about individual staff members. How it is used, held and disclosed is in clause 5.

**4.4 When you download the Software** from the **Microsoft Store** or from our distribution page **https://camog-license.cliniciq.com.au**, that channel is operated by third parties (Microsoft; and Cloudflare, which hosts the activation service). Your access to those channels is governed by the providers' own privacy policies and terms; we do not control them.

**4.5 When you buy a licence.** When you purchase a licence through our website's checkout (operated by **Stripe**), we receive and hold the billing email address, the practice name entered at checkout, and the licence record generated from the purchase (the key, its tier and device seats, and its term). We never receive your card details — payment card information is collected, processed and stored by Stripe under its own privacy policy and PCI-DSS compliance. How these purchase records are used and held is in clause 5.

## 5. How we use, hold and disclose that information

We use contact details only to respond to your enquiry and to keep a record of our correspondence. We hold correspondence only as long as needed for that purpose, then delete or de-identify it. We do not use it for direct marketing and do not disclose it except to service providers who help us operate our communications (such as email hosting) under confidentiality, or where required by law.

Licence activation records (clause 4.3) are used only to enforce the device seats a licence covers and to support seat moves when a practice replaces a computer. They are held in Cloudflare's D1 database service for the licence term plus 12 months, then deleted. Cloudflare processes them only to host and secure the activation service (see clause 10).

Purchase records (clause 4.5) are used only to deliver the licence key you bought, to support the licence (seat moves, renewals, refunds) and to meet our record-keeping obligations under Australian tax law. They are held in Cloudflare's D1 database service and in our Stripe account for the licence term plus 12 months (or longer where tax law requires financial records), then deleted. Stripe processes your payment details only to take the payment. We do not use purchase contact details for direct marketing.

## Part B — How Camog handles personal and health information

## 6. Kinds of personal information the Software collects and holds (APP 1.4(a))

All of the following is stored **locally by the Software on your organisation's device**, on behalf of your organisation:

| Category | Examples | Classification |
|---|---|---|
| Patient identity | Patient name; optional date of birth | Personal information; health information in this context |
| Clinical photographs | The images themselves (JPEG), including any annotated copies (annotations are always saved as a new image — the original is never modified) | Health information / sensitive information |
| Photo documentation metadata | Body region (14 anatomical regions via the body-map picker), free-text body subpart, capture date/time, capturing clinician, free-text clinical notes (up to 2,000 characters) | Health information |
| Consent records | Consent scope (clinical care; education and training; research), date given, optional expiry date, and which clinician recorded it | Health information |
| User accounts | Username, display name, role (administrator or clinician), salted hash of the account passcode, user preferences, creation and last-login timestamps | Personal information |
| Audit log | Append-only record of actions — sign-ins and sign-outs, patient and photo changes, consent changes, annotations, exports and backups — with the acting clinician, the patient's name as it was recorded at the time, timestamp and free-text detail. Entries that would identify a patient are redacted for non-administrator viewers | Personal and health information |
| Backups | Complete snapshots of the database, written into your configured storage folder when an administrator creates one | All of the above |

The Software does **not** collect: address, phone number, email address, Medicare number, Individual Healthcare Identifier, health fund details, biometric templates, payment details, or precise device location.

## 7. How information is collected and held (APP 1.4(b))

**7.1 Collection.** Information is collected directly by your organisation's staff, from patients, in the clinic: by camera capture through the app, by importing image files, by receiving a photo from a phone on the same Wi-Fi network (the phone-camera tether), and by manual entry (patient name, date of birth, body location, clinical notes, consent details).

**7.2 Holding.** Records are held in a local SQLite database file and as image files on the computer's storage — by default in the application data folder, or in any folder your administrator designates (which may be a network drive or a cloud-synced folder; see clause 10). Database backups are written to the same folder.

**7.3 Security measures built into the Software.** Account passcodes are hashed with PBKDF2-SHA256 using a per-user random salt (passcodes are never stored in readable form); access is role-based (administrators see all patients; clinicians see only patients they own, that are organisation-shared, or explicitly granted to them); each account session expires after a configurable timeout; an idle privacy screen covers patient information after a configurable period of inactivity; all significant actions are written to an append-only audit log that administrators can review; and the phone-link server authenticates each request with a per-device session cookie issued when the phone first presents its random pairing code. The pairing code and sessions live only in the app's memory and the pairing code in the app data folder — sessions end when the link ends (manually, on app restart, or after 30 minutes of phone inactivity); unauthenticated requests are rate-limited per source address and answered identically to unknown routes; and the photo files the phone may fetch are restricted to an explicit whitelist of filenames.

**7.4 Honest limitations you should plan around.** Photographs and thumbnails are **encrypted by the Software at rest** (AES-256-GCM); the decryption key is generated by the Software and held in a key file inside the application data directory (owner-only file permissions), and photographs cannot be opened without it. The **database is not encrypted** by the Software, and neither are exported report PDFs. Attached result files are **encrypted at rest** with the same key as photographs. Database backups are **encrypted with a passphrase** your practice chooses each time it creates a backup — the Software cannot recover a lost passphrase, and a backup without its passphrase cannot be restored. Backups are not scheduled automatically. Deleted photos are soft-deleted (recoverable) and no feature permanently deletes a patient record. Licence activation also keeps a random device-identifier file (~/.camog/device-id) in the user's home directory, deliberately outside the application data folder; it contains no patient information, and deleting it simply means the licence must be re-activated (one internet check). We recommend full-disk encryption on every device running Camog, physically secured storage folders, and secure handling of backup files.

## 8. Use and disclosure (APP 1.4(c), APP 6)

**8.1 Use.** All processing happens on your organisation's device. The Software uses patient information for: clinical documentation and monitoring of conditions over time (for example wound or lesion progression using the photo compare feature); practice administration and access control; accountability through the audit log; and backup.

**8.2 Disclosure by the Software: none.** The Software does not disclose patient information to us or to any third party. Its only outbound connection is the licence activation check (Terms of Service clause 3.2), which contains no patient information.

**8.3 Disclosures your organisation controls.** Your organisation is responsible for ensuring each of the following has a lawful basis (generally, the primary purpose of providing health care, or consent):

- **Cloud-synced storage/backups** — if the storage folder is inside a cloud-sync service, that provider receives your patients' photographs and records (clause 10).
- **Phone link (phone-camera tether and companion viewer)** — photographs captured on a paired phone are transmitted over your local network to your computer **unencrypted** (plain HTTP — see clause 7.3 for the access controls). While the link is open and library sharing is switched on, the paired phone can also view the same access-filtered patient list, photographs and reports the signed-in clinician can see, and request review and report actions that run through the same permission-checked services. The pairing code crosses the network each time a phone pairs, and the session cookie travels with every phone request — anyone able to intercept traffic on that network could in theory view both. Use the link only on a trusted private network you control (or over an encrypted tunnel such as Tailscale), rotate the pairing code if it may have been seen, and end the session when you are done. The security notes distributed with the Software describe the controls and their limits in full for IT reviewers.
- **Case reports** — printing a patient case report (which includes photographs, notes and consent status) creates a paper record; handle and store it as securely as the digital one. Printing is recorded in the audit log.
- **Internal sharing** — the Software's organisation-share and per-clinician sharing settings control which of your staff can see a patient. Configure them to match your patients' expectations and your legal obligations.

**8.4 Secondary purposes.** Using clinical photographs for education, training or research is a secondary purpose and requires the patient's consent. The Software lets your clinicians record that consent (scope, date and optional expiry) and warns when a patient has no valid consent on record — but it is your organisation's responsibility to obtain, document and honour consent properly (see clauses 11 and 16).

## 9. Direct marketing (APP 7)

The Software does not use, and must not be used to use, health information for direct marketing. We do not use your information for direct marketing.

## 10. Overseas disclosure (APP 1.4(f), APP 8)

The Software itself discloses no information to anyone, in Australia or overseas. However, if your administrator configures storage or backups inside a cloud-synced folder, your provider may store the data on servers outside Australia. Your organisation must take reasonable steps (for example, checking the provider's privacy policy and contractual commitments) to ensure that provider protects the information to a standard substantially similar to the Australian Privacy Principles — and you remain accountable for it under APP 8.

Our activation service is hosted on Cloudflare's worldwide network, so licence activation records (clause 4.3) may be processed outside Australia. Cloudflare is bound by its own privacy commitments as our infrastructure provider, and we remain accountable under APP 8 for that processing.

## 11. Health information, consent and clinical photography (APP 3)

Clinical photographs, clinical notes and consent records are **health information** — a type of sensitive information — and should only be collected with the patient's knowledge and, where required, their consent. Before photographing a patient, your clinicians should explain what will be photographed, why, who will see it and for how long it will be kept, consistent with Ahpra and Medical Board of Australia guidance and the OAIC's guidance on taking photos of patients.

**What the Software's consent records capture:** the scope selected (clinical care; education and training; research), the date and time it was recorded, an optional expiry, and which clinician recorded it. **What they do not capture:** who gave the consent (the patient or a guardian) or a signature. Your organisation should keep its own signed consent forms and note them against the patient record.

Where a patient is a child or does not have capacity to consent, consent must be obtained from a parent, guardian or other authorised person — record that fact in your own consent documentation.

## 12. Data breaches (Notifiable Data Breaches scheme)

If your organisation suspects a data breach involving information held in Camog (for example, a lost or stolen computer, an exposed storage folder or a misdirected printed report), you must assess it within 30 days and, if it is likely to result in serious harm to any individual, notify the Office of the Australian Information Commissioner (OAIC) and the affected individuals. Advice: oaic.gov.au (Notifiable Data Breaches scheme). Because the data never leaves your device unless you configured it to, we cannot detect or report breaches on your behalf.

## 13. Access and correction (APPs 12–13)

Patients should direct requests for access to, or correction of, their information to **your organisation**, which holds it. The Software supports you in responding: patient details and photo metadata can be edited, annotated copies never overwrite originals, and a printable case report (photographs, dates, body locations, notes and consent status) can be generated and saved as a PDF. To protect the integrity of the medical record, audit log entries cannot be edited or deleted in normal use. The one exception is the administrator **factory reset** (Settings), which requires typing a confirmation phrase and erases all local records — including the audit log, because it destroys the record entirely (clause 14).

## 14. Retention and destruction (APP 11.2)

The Software has **no automatic retention or destruction**: patients can only be archived (not deleted), photos are soft-deleted (recoverable), and no data is ever purged automatically. Your organisation must apply the health record retention rules applicable to your practice — as a general guide, health records must be retained for at least 7 years after the last entry, and records of child patients until the child turns 25, but the exact periods vary by state and territory and you should confirm your obligations.

To truly destroy all Camog data on a device you must delete: the application data directory (which contains the database), **the configured storage folder** (photographs, thumbnails and any backups), and every copy of every backup file you created — and then securely erase them (for example, by wiping the drive). Deleting the app alone is not enough: encrypted photographs can only be read with the key file the Software keeps in the application data directory — deleting that directory also destroys the key. (Versions before 0.4.7 kept the key in the operating system's credential store; the Software migrates it to the key file and removes the old entry automatically.) The licence device-identifier file (~/.camog/device-id) is stored in the user's home directory (clause 7.4); delete it too if you also want to clear that device's activation.

## 15. State and territory health privacy laws

The *Privacy Act 1988* (Cth) applies to private health service providers **everywhere in Australia** — the small business exemption does not apply to health service providers. In addition:

| State/territory | Additional law applying to private health service providers |
|---|---|
| NSW | *Health Records and Information Privacy Act 2002* (NSW) |
| Victoria | *Health Records Act 2001* (Vic) |
| ACT | *Health Records (Privacy and Access) Act 1997* (ACT) |
| Queensland, Tasmania, NT | No private-sector health privacy legislation — the Commonwealth *Privacy Act 1988* applies |
| South Australia, Western Australia | No equivalent private-sector scheme — the Commonwealth *Privacy Act 1988* applies |

## 16. If your organisation uses Camog — compliance checklist

To meet your own obligations as an APP entity, you should:

1. publish your **own APP 1 privacy policy** and give patients an **APP 5 collection notice** when you collect their photographs and details (your reception or consent paperwork is a natural place for this);
2. keep **signed consent forms** for clinical photography (including who consented and any guardian's details), noting that Camog's consent record captures scope, date, expiry and recording clinician only;
3. use the Software's **access controls** so each clinician sees only the patients they should;
4. turn on the **session timeout and idle privacy screen** with settings suited to your clinic rooms;
5. enable **full-disk encryption** on every device running Camog, and protect the storage folder and backup files;
6. decide and document your **retention and destruction** procedure, including how you will destroy storage folders and backups when retention periods end;
7. have a **data breach response plan** covering lost devices, exposed folders and misdirected reports (clause 12); and
8. if you use a **cloud-synced folder**, check that provider's privacy policy and data locations (clause 10).

## 17. Automated decision-making

From 10 December 2026, APP entities must disclose in their privacy policies the use of computer programs that make, or substantially and directly assist in making, decisions that could significantly affect an individual's rights or interests. **Camog contains no such programs** — it makes no automated decisions about any individual. This clause is included to confirm that position as at the effective date.

## 18. Changes to this policy

We may update this policy from time to time. The current version, with its effective date, will be published at **https://camog-license.cliniciq.com.au**. If we make a material change to how the Software handles information (for example, adding any telemetry or cloud feature), we will update this policy before or with the release that makes the change.

## 19. Complaints

**About us:** contact our privacy contact (clause 1). We will respond within a reasonable time.

**If you are unhappy with our response, or with how an organisation using Camog handled your information**, you may complain to the Office of the Australian Information Commissioner:

- Phone: 1300 363 992 · Email: enquiries@oaic.gov.au · GPO Box 2999, Sydney NSW 2001 · oaic.gov.au

Patients may also complain to their state or territory health complaints body (for example, the NSW Health Care Complaints Commission, the Health Complaints Commissioner (Vic), or the ACT Human Rights Commission), which handle complaints about health service providers including privacy matters.

## 20. Legislation and guidance referenced

*Privacy Act 1988* (Cth) and the Australian Privacy Principles; *Competition and Consumer Act 2010* (Cth) Schedule 2 (Australian Consumer Law); Notifiable Data Breaches scheme; *Health Records and Information Privacy Act 2002* (NSW); *Health Records Act 2001* (Vic); *Health Records (Privacy and Access) Act 1997* (ACT); OAIC guidance on APP privacy policies, on health service providers and on taking photos of patients; Ahpra and Medical Board of Australia professional guidance on clinical photography.
