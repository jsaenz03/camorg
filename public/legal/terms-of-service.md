# Camog — Terms of Service

**Effective date:** 23/08/2026 · **Version:** 1.0

> **DRAFT FOR REVIEW — NOT LEGAL ADVICE.**
> Supplier details are completed (entity, ABN, address, contact, distribution). This document must still be reviewed by a qualified Australian lawyer before publication or use.
> Statements about how the Software works reflect Camog v0.1.x. If the Software changes (for example, if telemetry, cloud services or fees are ever added), these Terms and the Privacy Policy must be updated to match.

---

## 1. Agreement to these Terms

1.1 These Terms of Service ("**Terms**") are a legal agreement between you and **John Raphael Saenz** ABN **55 882 511 758** ("**we**", "**us**", "**Supplier**") in relation to the Camog clinical photo documentation software, including any copies and any updates we release ("**Software**").

1.2 "**You**" means the organisation (such as a medical practice or clinic) on whose computer the Software is installed. If you accept these Terms on behalf of an organisation, you warrant that you are authorised to bind that organisation.

1.3 By installing, copying or using the Software, you accept these Terms and agree to be bound by them. If you do not accept these Terms, do not install or use the Software.

1.4 The Software is licensed, not sold. We reserve all rights not expressly granted to you.

## 2. Important summaries

The following points are summaries only and do not replace the full clauses that follow:

- Camog is a **clinical documentation tool only** — it is not a diagnostic device and does not provide medical advice (clause 6).
- **Your patient data stays on your devices.** The Software sends nothing to us: it has no telemetry, analytics or crash reporting (clause 7).
- **You are responsible for your privacy compliance** under the *Privacy Act 1988* (Cth), state and territory health records laws, and for obtaining patient consent to clinical photography (clause 7).
- Our liability is limited as far as the law allows, but **your rights under the Australian Consumer Law are not excluded** (clauses 11–12).

## 3. Licence grant

3.1 Subject to these Terms, we grant you a **non-exclusive, non-transferable, non-sublicensable, revocable** licence to install and run the Software on computers you own or control, for your internal clinical documentation and practice administration purposes.

3.2 **[Confirm commercial model — e.g. "The Software is currently supplied free of charge." Amend this clause if fees, subscriptions or licence keys are introduced.]**

3.3 The Software incorporates third-party open-source components (including the Tauri, React and Next.js frameworks and their dependencies). Those components are licensed to you under their own licence terms, and nothing in these Terms limits any rights those licences give you. A current list is in the `package.json` and `src-tauri/Cargo.toml` manifests distributed with the source code.

## 4. Restrictions

Except where the *Copyright Act 1968* (Cth) or another law expressly permits you to do so without our consent (for example, for interoperability or security testing), you must not, and must not allow anyone else to:

(a) sub-license, resell, rent, lease, distribute or host the Software as a service for third parties;
(b) remove or obscure our branding, copyright or other notices;
(c) reverse engineer, decompile or disassemble the Software;
(d) circumvent or attempt to circumvent the Software's access controls, passcode protections or session controls; or
(e) alter, suppress or interfere with the Software's **append-only audit log** or its audit records (including the audit entries written when a case report is printed).

## 5. Accounts, security and your responsibilities

5.1 The first account created on an installation becomes the **organisation administrator**. Administrators manage user accounts, invitations, approval of public sign-ups, patient access and sharing, the storage location, backups and the audit log viewer.

5.2 You are responsible for:

(a) keeping account passcodes confidential and using the session-timeout and idle privacy-lock settings appropriate to your clinic environment;
(b) the acts and omissions of your users;
(c) physically and electronically securing the computers and networks on which the Software runs, including using full-disk encryption (for example, FileVault or BitLocker) on any device holding patient photographs;
(d) taking and safely storing regular backups — the Software's backup feature creates a database snapshot in your configured storage folder, and **backups are not encrypted by the Software**; and
(e) using the **phone-camera tether** feature only on a trusted, private network you control. The tether runs a small web server on your computer that receives photos from phones on the same local network over **unencrypted HTTP**, protected only by a random single-use token. Do not use it on public or shared Wi-Fi.

5.3 The Software's idle privacy lock is a **privacy screen, not a security control or encryption**. It covers the screen but does not end the signed-in session.

## 6. Clinical use — not a therapeutic good, no medical advice

6.1 The Software is a record-keeping and photo-documentation tool. It is **not included in the Australian Register of Therapeutic Goods (ARTG)**, is not a therapeutic good, and is not intended for the diagnosis, monitoring, prevention, treatment or alleviation of disease in any person. Its functions (capture, storage, annotation, comparison, body mapping, search, reporting and audit of clinical photographs) fall within TGA's excluded categories of image storage and electronic records software.

6.2 Nothing in the Software is medical advice, and no feature (including photo comparison or annotation) substitutes for clinical judgement. Treating clinicians remain solely responsible for all clinical decisions and for the adequacy and completeness of the patient record.

6.3 The Software must not be your only copy of clinical records. You must comply with the medical record keeping and retention obligations that apply to your practice under the laws of your state or territory and your professional codes.

6.4 When capturing clinical photographs, you must comply with your professional obligations, including Ahpra and Medical Board of Australia guidance on clinical photography and patient consent.

## 7. Patient information and privacy

7.1 The Software stores all patient information **locally on your computer** (a local database and image files on your device's storage, or a folder your administrator selects). The Software **does not transmit any patient information to us or to any third party**. It contains no telemetry, no analytics and no crash reporting, and it makes no outbound internet connections.

7.2 As a health service provider, you are bound by the *Privacy Act 1988* (Cth) and the Australian Privacy Principles (health service providers cannot rely on the small business exemption). In New South Wales, Victoria and the Australian Capital Territory, private health service providers must also comply with state or territory health records legislation. **You, not we, are the operator of the patient records held in the Software.**

7.3 You must obtain and document **patient consent** for clinical photography (including the scope of use — clinical care, education and training, or research — and any expiry) before collecting or using a patient's photographs. The Software's consent records note the scope, date, expiry and the clinician who recorded it; they **do not record who gave consent or capture a signature**, and they do not replace your own consent forms and documentation.

7.4 If your administrator configures the Software's storage or backup folder to be a **cloud-synced folder** (such as OneDrive, Dropbox or iCloud), patient photographs and backups may be transmitted and stored by that provider outside your device. That is your choice and your disclosure; you are responsible for assessing that provider's security, privacy policy and data storage locations against your obligations under the Australian Privacy Principles.

7.5 The only personal information we may ever receive about you or your staff is information you choose to give us if you contact us for support (see our Privacy Policy).

## 8. Acceptable use

You must not use the Software:

(a) to create, store or process photographs or records you are not lawfully entitled to hold;
(b) to photograph or record a person without a lawful basis and, where required, consent;
(c) for any unlawful, infringing, defamatory or inappropriate purpose; or
(d) in breach of these Terms, the *Privacy Act 1988* (Cth), state or territory health records laws, or your professional codes of conduct.

## 9. Updates and availability

9.1 Updates are distributed as downloadable installers from **https://github.com/jsaenz03/camorg/releases**. The Software has no automatic updater; you choose whether and when to install updates.

9.2 We do not guarantee that updates will be released, or that any release will remain available, for any period. Because the Software runs entirely on your device, we give no uptime, availability or support commitments except as required by the Australian Consumer Law.

## 10. Pre-release software

Version 0.1.x is an early ("beta") release. It may contain defects, and features may change. The installers are **not code-signed**, so your operating system may show security warnings (for example macOS Gatekeeper or Windows SmartScreen) that you must assess before proceeding. Verify that you downloaded the installer from our official distribution point before installing.

## 11. Warranties and the Australian Consumer Law

11.1 Our goods and services come with guarantees that cannot be excluded under the **Australian Consumer Law** (Schedule 2 of the *Competition and Consumer Act 2010* (Cth)). For any goods or services to which those guarantees apply, nothing in these Terms excludes, restricts or modifies those guarantees, or any right or remedy of yours under that law.

11.2 Except for those guarantees, and to the extent permitted by law, the Software is supplied "as is" without warranty. We do not warrant that the Software will be error-free, uninterrupted, secure or fit for any particular purpose, and we give no warranty regarding the integrity, security or recoverability of your data. You are solely responsible for backing up your data.

## 12. Limitation of liability

12.1 To the extent we are permitted to do so by the Australian Consumer Law, our liability for a breach of a consumer guarantee is limited, at our election, to: (a) the replacement or re-supply of the Software; or (b) the payment of the cost of replacing or re-supplying the Software (or of acquiring equivalent software).

12.2 Subject to clause 12.1, we are not liable for any indirect, incidental or consequential loss, or for any loss of profits, revenue, goodwill or **loss or corruption of data**, however caused (including by defects in the Software or by use of the phone-camera tether or backup features).

12.3 Subject to clauses 12.1 and 12.2, our aggregate liability arising out of or in connection with the Software is limited to **[AMOUNT — e.g. AUD $100, or the fees you paid us in the 12 months before the claim, whichever is greater]**.

12.4 Nothing in these Terms excludes or limits any liability that cannot lawfully be excluded or limited, including liability for fraud, or for death or personal injury caused by negligence.

## 13. Indemnity

To the extent permitted by law, you indemnify us against claims, losses and expenses (including reasonable legal costs) arising from: (a) your or your users' use of the Software; (b) claims by patients or other third parties relating to photographs, records or consent created or held by you; or (c) your breach of these Terms, of the *Privacy Act 1988* (Cth), or of any privacy, health records or consent obligation — except to the extent caused by our breach of these Terms.

## 14. Term and termination

14.1 These Terms apply from the first installation of the Software and continue while you use it.

14.2 You may stop using the Software at any time by uninstalling it.

14.3 We may terminate your licence with immediate notice if you materially breach these Terms (including clause 4 or clause 8), in which case you must stop using the Software and delete all copies.

14.4 Because your data never leaves your devices, termination of these Terms does not affect data we never held: on termination you may export or delete your data as you choose. Clauses 1, 4, 6, 11, 12, 13 and 16 survive termination.

## 15. Changes to these Terms

We may amend these Terms from time to time. Material changes will be published at **https://github.com/jsaenz03/camorg/releases** with the relevant release. If you install or continue using the Software after the amended Terms take effect, you accept the amended Terms.

## 16. Governing law

These Terms are governed by the laws of **[INSERT AUSTRALIAN STATE OR TERRITORY — e.g. New South Wales]**, Australia, and you and we submit to the non-exclusive jurisdiction of the courts of that state or territory. Nothing in these Terms affects your rights under the Australian Consumer Law or any other law that cannot be excluded.

## 17. General

(a) These Terms are the entire agreement between you and us regarding the Software. (b) You must not assign these Terms without our written consent; we may assign them. (c) If a clause is invalid, the remainder continues to apply. (d) Our failure or delay in exercising a right is not a waiver of it. (e) You and we are independent contractors; no agency, partnership or employment relationship is created.

## 18. Contact

**John Raphael Saenz** · ABN **55 882 511 758** · **Wollongong NSW 2500, Australia** · Email: **admin@cliniciq.com.au** · Distribution: **https://github.com/jsaenz03/camorg/releases**
