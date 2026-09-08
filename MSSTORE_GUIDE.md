# Camog — Microsoft Store submission guide

Prerequisites: a finished 0.6.0+ build (CI attaches the Windows installers to
the release), the activation server deployed (`activation-server/README.md`),
and the public legal pages live (`https://camog-license.cliniciq.com.au`).

## 1. Partner Center account

Register at https://developer.microsoft.com/en-us/windows → **Partner
Center** (individual account: one-off ~USD $19; company accounts need a
D-U-N-S number). Complete identity verification before reserving anything.

## 2. Reserve the app + get the package identity

1. Partner Center → **Apps and Games → New product → Windows app**; reserve
   the name **Camog** (do this early — names are claimed first-come).
2. Open the app → **App management → App identity**. Copy:
   - **Package/Identity → Name** (a long value like `12345ClinicIQSolution…`)
   - **Package/Identity → Publisher** (`CN=…`)
3. You will pass these two values to `scripts/make-msix.ps1`.

## 3. Choose the package and produce it

The Store accepts two forms of Win32 desktop app. Both end up listed
identically; they differ in how much packaging work you do.

**Option A — upload the CI-built `.msi` (recommended; simplest).** Since
2022 the Store accepts *unpackaged* Win32 installers (`.msi`/`.exe`)
directly. Your release already contains `Camog_X.Y.Z_x64_en-US.msi` from
CI — upload it as-is, no repackaging. Certification requires the installer
to install silently; Tauri's WiX MSI does (`msiexec /i Camog.msi /qn`).
Skip to section 4.

**Option B — wrap into MSIX (optional, later).** MSIX gives the app a Store
package identity and Store-managed installs/updates, at the cost of a
repackaging step on a Windows machine (Tauri v2 has no MSIX bundle target —
the 0.4.11 attempt was reverted for this reason). If you want it:

1. On a Windows 10/11 machine (or VM) with the Windows SDK, install the
   release's `Camog_*_x64-setup.exe` (NSIS).
2. Run:
   ```powershell
   .\scripts\make-msix.ps1 `
     -AppDir "C:\Program Files\Camog" `
     -Version "0.6.0.0" `
     -IdentityName "<identity Name from step 2>" `
     -Publisher "<identity Publisher from step 2>"
   ```
3. That emits `msix\Camog_0.6.0.0_x64.msix`. Local signing is optional —
   the Store signs what it distributes.

You can start with Option A and move to B in a later submission; nothing
else in the listing changes.

## 4. The submission

Start the submission and complete every section:

- **Packages**: upload the release `.msi` (Option A) or the `.msix`
  (Option B).
- **Store listing**: description, screenshots (1600×900 or 3840×2160; capture
  the dashboard, capture dialog, report, Settings → Licence), keywords.
- **Web details**: privacy policy URL = `https://camog-license.cliniciq.com.au/legal/privacy-policy.md`
  (this URL is the Store's mandatory field and is why the legal pages live on
  the activation worker). Terms of Use (optional):
  `https://camog-license.cliniciq.com.au/legal/terms-of-service.md`.
- **Age questionnaire**: clinical photography documentation; the IARC answers
  land around PEGI 12 / ESRB E10+ — no explicit content, no ads, no sharing
  to socials.
- **Compliance / data collection**: the app collects no patient data. It does
  transfer two non-personal items at licence activation (licence key + random
  device ID) — declare "your app transfers data" and link the same privacy
  policy, per Privacy cl 4.1/4.3. Health-data disclosures: the app **handles
  health data, all stored locally** under the practice's control; that is the
  practice's compliance story (Privacy cl 3, 16), not Microsoft's.
- **Notes for certification** (free-text to reviewers): "Clinical photo
  documentation for healthcare practices; all patient data is stored locally
  on the device. The app contacts our licence server once, at activation,
  transmitting only the licence key and a random device identifier."
- Certification typically takes 1–3 business days; the usual rejections are
  missing screenshots, incomplete age questionnaire, or a privacy-policy URL
  that doesn't resolve — all covered above.

## 5. After approval

- The Store listing goes live when you publish; you control rollout.
- Updates: bump the version, rebuild, re-run `make-msix.ps1` with the same
  identity (version must be strictly higher), upload a new submission.
- macOS stays on direct download (`MACOS_GUIDE.md`) until Apple notarisation;
  ToS cl 10 already tells users exactly that.
