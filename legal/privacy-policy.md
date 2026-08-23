# Camog Privacy Policy

**Effective date:** 23/08/2026 · **Version:** 1.0

> **DRAFT FOR REVIEW — NOT LEGAL ADVICE.**
> This document contains `[SQUARE-BRACKET PLACEHOLDERS]` that the supplier must complete (legal entity name, ABN, address, contact details, privacy officer). It must be reviewed by a qualified Australian lawyer before publication or use.
> Descriptions of how the Software works reflect Camog v0.1.x. If the Software ever changes (for example, if telemetry, cloud services or automatic updates are added), this policy must be updated — claims like "we receive nothing" are only true while the code makes them true.

---

## 1. Who we are

**[SUPPLIER LEGAL ENTITY NAME]** ABN **[__ ___ ___ ___]**, of **[POSTAL ADDRESS]** ("we", "us", "Supplier") is the supplier of the Camog clinical photo documentation software ("**Software**").

**Privacy contact:** [PRIVACY OFFICER NAME OR ROLE] · **[EMAIL]** · **[PHONE]**.

## 2. At a glance

- Camog is a **local-first desktop application**. Patient records and photographs are stored in a database and image folder **on your own computer** (or a folder your organisation's administrator chooses).
- The Software **sends no information to us**. It has no telemetry, no analytics, no advertising tools, no crash reporting and no cloud backend, and it makes no outbound internet connections.
- We never see, receive, host, back up or access your patients' information through the Software.
- If your administrator points the storage folder at a **cloud-synced folder** (OneDrive, Dropbox, iCloud or similar), your information may leave your computer through *that provider's* service — that is your organisation's choice and is not controlled by us or the Software (see clause 10).
- The **phone-camera tether** feature transmits each photo across your own local Wi-Fi network, unencrypted, to your computer. It works only while the capture screen is open and is protected by a random single-use token (see clause 8.3).
- The Software is **not connected to My Health Record** or any national e-health system.

## 3. About this policy and who it protects

This policy has two parts:

- **Part A (clauses 4–5)** — the very limited personal information handled by us, the Supplier. This is the part that satisfies APP 1 of the *Privacy Act 1988* (Cth) for our own activities.
- **Part B (clauses 6–17)** — how the Camog Software collects, holds, uses and protects personal and health information **on behalf of the organisation that runs it**, and that organisation's obligations.

**Important for organisations using Camog:** if you are a health service provider (a practice, clinic or practitioner), **you are the APP entity** responsible for the patient information you record in Camog. This policy explains how the Software works but it does **not** replace your own APP 1 privacy policy and your APP 5 collection notices to patients. See clause 16.

## Part A — Personal information handled by the Supplier

## 4. What we collect and hold

**4.1 Through the Software: nothing.** The Software collects no information for us. It has no telemetry, analytics, crash reporting, advertising integrations, or automatic update checks, and its web view is blocked from connecting to the internet. We do not receive your organisation's data, your users' account data, your patients' photographs, or any usage statistics.

**4.2 If you contact us** (for example, by emailing support), we hold the personal information you choose to give us, such as your name, email address, phone number, organisation name and the contents of your message (which may include information about patients if you include it — **please de-identify patient details before sending us anything**).

**4.3 When you download the Software** from our distribution page **[URL]**, that page is hosted by a third party (such as GitHub). Your access to the page is governed by that provider's own privacy policy and terms; we do not control it.

## 5. How we use, hold and disclose that information

We use contact details only to respond to your enquiry and to keep a record of our correspondence. We hold correspondence only as long as needed for that purpose, then delete or de-identify it. We do not use it for direct marketing and do not disclose it except to service providers who help us operate our communications (such as email hosting) under confidentiality, or where required by law.

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
| Audit log | Append-only record of actions — sign-ins and sign-outs, patient and photo changes, consent changes, annotations, exports and backups — with the acting clinician, patient reference, timestamp and free-text detail | Personal and health information |
| Backups | Complete snapshots of the database, written into your configured storage folder when an administrator creates one | All of the above |

The Software does **not** collect: address, phone number, email address, Medicare number, Individual Healthcare Identifier, health fund details, biometric templates, payment details, or precise device location.

## 7. How information is collected and held (APP 1.4(b))

**7.1 Collection.** Information is collected directly by your organisation's staff, from patients, in the clinic: by camera capture through the app, by importing image files, by receiving a photo from a phone on the same Wi-Fi network (the phone-camera tether), and by manual entry (patient name, date of birth, body location, clinical notes, consent details).

**7.2 Holding.** Records are held in a local SQLite database file and as image files on the computer's storage — by default in the application data folder, or in any folder your administrator designates (which may be a network drive or a cloud-synced folder; see clause 10). Database backups are written to the same folder.

**7.3 Security measures built into the Software.** Account passcodes are hashed with PBKDF2-SHA256 using a per-user random salt (passcodes are never stored in readable form); access is role-based (administrators see all patients; clinicians see only patients they own, that are organisation-shared, or explicitly granted to them); each account session expires after a configurable timeout; an idle privacy screen covers patient information after a configurable period of inactivity; all significant actions are written to an append-only audit log that administrators can review; and the phone-tether server accepts only a random single-use token and shuts down when the capture screen closes.

**7.4 Honest limitations you should plan around.** The database and image files are **not encrypted by the Software** at rest. The idle privacy screen hides content on screen but does not encrypt or sign the user out. Backups are not encrypted or scheduled automatically. Deleted photos are soft-deleted (recoverable) and no feature permanently deletes a patient record. We recommend full-disk encryption on every device running Camog, physically secured storage folders, and secure handling of backup files.

## 8. Use and disclosure (APP 1.4(c), APP 6)

**8.1 Use.** All processing happens on your organisation's device. The Software uses patient information for: clinical documentation and monitoring of conditions over time (for example wound or lesion progression using the photo compare feature); practice administration and access control; accountability through the audit log; and backup.

**8.2 Disclosure by the Software: none.** The Software does not disclose patient information to us or to any third party. It makes no outbound connections.

**8.3 Disclosures your organisation controls.** Your organisation is responsible for ensuring each of the following has a lawful basis (generally, the primary purpose of providing health care, or consent):

- **Cloud-synced storage/backups** — if the storage folder is inside a cloud-sync service, that provider receives your patients' photographs and records (clause 10).
- **Phone-camera tether** — each captured photo is transmitted over your local Wi-Fi network, unencrypted, from the phone to your computer. Use it only on a trusted private network you control. Anyone able to intercept traffic on that network could in theory view the photo.
- **Case reports** — printing a patient case report (which includes photographs, notes and consent status) creates a paper record; handle and store it as securely as the digital one. Printing is recorded in the audit log.
- **Internal sharing** — the Software's organisation-share and per-clinician sharing settings control which of your staff can see a patient. Configure them to match your patients' expectations and your legal obligations.

**8.4 Secondary purposes.** Using clinical photographs for education, training or research is a secondary purpose and requires the patient's consent. The Software lets your clinicians record that consent (scope, date and optional expiry) and warns when a patient has no valid consent on record — but it is your organisation's responsibility to obtain, document and honour consent properly (see clauses 11 and 16).

## 9. Direct marketing (APP 7)

The Software does not use, and must not be used to use, health information for direct marketing. We do not use your information for direct marketing.

## 10. Overseas disclosure (APP 1.4(f), APP 8)

The Software itself discloses no information to anyone, in Australia or overseas. However, if your administrator configures storage or backups inside a cloud-synced folder, your provider may store the data on servers outside Australia. Your organisation must take reasonable steps (for example, checking the provider's privacy policy and contractual commitments) to ensure that provider protects the information to a standard substantially similar to the Australian Privacy Principles — and you remain accountable for it under APP 8.

## 11. Health information, consent and clinical photography (APP 3)

Clinical photographs, clinical notes and consent records are **health information** — a type of sensitive information — and should only be collected with the patient's knowledge and, where required, their consent. Before photographing a patient, your clinicians should explain what will be photographed, why, who will see it and for how long it will be kept, consistent with Ahpra and Medical Board of Australia guidance and the OAIC's guidance on taking photos of patients.

**What the Software's consent records capture:** the scope selected (clinical care; education and training; research), the date and time it was recorded, an optional expiry, and which clinician recorded it. **What they do not capture:** who gave the consent (the patient or a guardian) or a signature. Your organisation should keep its own signed consent forms and note them against the patient record.

Where a patient is a child or does not have capacity to consent, consent must be obtained from a parent, guardian or other authorised person — record that fact in your own consent documentation.

## 12. Data breaches (Notifiable Data Breaches scheme)

If your organisation suspects a data breach involving information held in Camog (for example, a lost or stolen computer, an exposed storage folder or a misdirected printed report), you must assess it within 30 days and, if it is likely to result in serious harm to any individual, notify the Office of the Australian Information Commissioner (OAIC) and the affected individuals. Advice: oaic.gov.au (Notifiable Data Breaches scheme). Because the data never leaves your device unless you configured it to, we cannot detect or report breaches on your behalf.

## 13. Access and correction (APPs 12–13)

Patients should direct requests for access to, or correction of, their information to **your organisation**, which holds it. The Software supports you in responding: patient details and photo metadata can be edited, annotated copies never overwrite originals, and a printable case report (photographs, dates, body locations, notes and consent status) can be generated and saved as a PDF. To protect the integrity of the medical record, audit log entries cannot be edited or deleted.

## 14. Retention and destruction (APP 11.2)

The Software has **no automatic retention or destruction**: patients can only be archived (not deleted), photos are soft-deleted (recoverable), and no data is ever purged automatically. Your organisation must apply the health record retention rules applicable to your practice — as a general guide, health records must be retained for at least 7 years after the last entry, and records of child patients until the child turns 25, but the exact periods vary by state and territory and you should confirm your obligations.

To truly destroy all Camog data on a device you must delete: the application data directory (which contains the database), **the configured storage folder** (photographs, thumbnails and any backups), and every copy of every backup file you created — and then securely erase them (for example, by wiping the drive).

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

We may update this policy from time to time. The current version, with its effective date, will be published at **[URL]**. If we make a material change to how the Software handles information (for example, adding any telemetry or cloud feature), we will update this policy before or with the release that makes the change.

## 19. Complaints

**About us:** contact our privacy contact (clause 1). We will respond within a reasonable time.

**If you are unhappy with our response, or with how an organisation using Camog handled your information**, you may complain to the Office of the Australian Information Commissioner:

- Phone: 1300 363 992 · Email: enquiries@oaic.gov.au · GPO Box 2999, Sydney NSW 2001 · oaic.gov.au

Patients may also complain to their state or territory health complaints body (for example, the NSW Health Care Complaints Commission, the Health Complaints Commissioner (Vic), or the ACT Human Rights Commission), which handle complaints about health service providers including privacy matters.

## 20. Legislation and guidance referenced

*Privacy Act 1988* (Cth) and the Australian Privacy Principles; *Competition and Consumer Act 2010* (Cth) Schedule 2 (Australian Consumer Law); Notifiable Data Breaches scheme; *Health Records and Information Privacy Act 2002* (NSW); *Health Records Act 2001* (Vic); *Health Records (Privacy and Access) Act 1997* (ACT); OAIC guidance on APP privacy policies, on health service providers and on taking photos of patients; Ahpra and Medical Board of Australia professional guidance on clinical photography.
