# macOS Signing & Notarisation Guide (Camog)

How to sign and notarise the Camog macOS build so Gatekeeper opens it without
scary warnings. Applies to the `aarch64-apple-darwin` and `x86_64-apple-darwin`
DMGs produced by `.github/workflows/build-desktop.yml`.

App identity used throughout: **Camog** (`com.camog.app`).

---

## Why sign at all

Unsigned, quarantined apps on modern macOS get the
**"Camog is damaged and can't be opened"** dialog — the old control-click
bypass is gone (Sequoia+); users would have to dig through System Settings →
Privacy & Security → Open Anyway, or run `xattr` commands. A Developer ID
signature plus notarisation makes the app open like any App Store download.

Signing = Apple-issued certificate proves the app came from you and hasn't
been tampered with. Notarisation = Apple scans the signed app and staples an
approval ticket to it. You need **both**.

---

## 1. Prerequisites

| Item | Where |
|---|---|
| Apple Developer Program membership (USD $99/yr) | [developer.apple.com/programs](https://developer.apple.com/programs/) |
| Team ID (10 characters) | developer.apple.com → **Membership details** |
| macOS build machine with Xcode CLT (`xcode-select --install`) | — |
| An Apple ID with the **App Manager** role or higher (for notarisation) | — |

The **Developer ID Application** certificate is what you need for direct
distribution (downloads from your website / GitHub releases). The Mac App
Store uses different certificates and is out of scope for this guide.

---

## 2. Create the Developer ID Application certificate

1. **Keychain Access** → menu *Keychain Access* → *Certificate Assistant* →
   *Request a Certificate From a Certificate Authority…*
   - Enter your email and common name, choose *Saved to disk*, save the `.certSigningRequest` file.
2. On [developer.apple.com](https://developer.apple.com/account/resources/certificates/list)
   → **Certificates** → **+** → **Developer ID Application** →
   upload the CSR → download the `.cer` file.
3. Double-click the `.cer` to install it into your login keychain. Verify with:

   ```sh
   security find-identity -v -p codesigning
   ```

   You should see:
   `1 valid identities found` with
   `Developer ID Application: <your name> (<TEAMID>)`.

4. **Export a `.p12` for CI** (needed later for GitHub Actions):
   Keychain Access → *My Certificates* → right-click the certificate →
   *Export "Developer ID Application…"* → format **Personal Information
   Exchange (.p12)** → set a strong password → save e.g. `camog-signing.p12`.

> **Note**: the certificate is tied to the private key on the machine that made
> the CSR. Keep the `.p12` (password-protected) as your portable copy; it is
> the only way to sign from CI or a second machine. Certificates expire —
> check the expiry date in Keychain Access and renew before it lapses.

---

## 3. Sign & notarise locally with Tauri (the easy path)

The Tauri bundler does everything — signs the `.app` with hardened runtime,
signs the DMG, submits it to Apple's notary service, staples the ticket —
as long as the right environment variables are set when you build.

### 3a. Notarisation credentials

Pick one of the two methods:

**Method A — App-specific password (simplest):**

1. Go to [appleid.apple.com](https://appleid.apple.com) → *Sign-In and Security*
   → **App-Specific Passwords** → generate one, e.g. `camog-notary`.
2. Export before building:

   ```sh
   export APPLE_SIGNING_IDENTITY="Developer ID Application: <your name> (<TEAMID>)"
   export APPLE_ID="you@example.com"
   export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password, NOT your Apple ID password
   export APPLE_TEAM_ID="XXXXXXXXXX"
   ```

**Method B — App Store Connect API key (more robust, no 2FA prompts):**

1. [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api)
   → *Integrations* → *App Store Connect API* → **+** → role **Developer** (or
   Admin) → download the `.p8` key once (you can't re-download it).
2. Export before building:

   ```sh
   export APPLE_SIGNING_IDENTITY="Developer ID Application: <your name> (<TEAMID>)"
   export APPLE_API_ISSUER="<issuer id from the keys page>"
   export APPLE_API_KEY="<key id, e.g. ABC123XYZ>"
   export APPLE_API_KEY_PATH="/secure/path/AuthKey_ABC123XYZ.p8"
   ```

### 3b. Build

```sh
npm run tauri build -- --target aarch64-apple-darwin
```

If the variables are set, Tauri logs the signing and notarisation steps. Output
lands in `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`.

Optionally pin the identity in `src-tauri/tauri.conf.json` instead of the env
var (env var still wins):

```json
"bundle": {
  "macOS": {
    "signingIdentity": "Developer ID Application: <your name> (<TEAMID>)"
  }
}
```

### Entitlements

Start with **none**. A Tauri (WKWebView) app signed with hardened runtime
generally needs no special entitlements for Developer ID distribution. Only add
an `entitlements` plist if the app misbehaves at runtime (e.g. JIT/library
validation errors from a native dependency) — declare just the single
entitlement that fixes it and re-test.

---

## 4. Verify the result

```sh
# Signature valid and anchored to a Apple-trusted cert
codesign --verify --deep --strict --verbose=2 Camog.app

# Gatekeeper assessment
spctl -a -t exec -vv Camog.app          # expect: accepted, source=Notarized Developer ID

# Ticket stapled to the DMG
xcrun stapler validate Camog_0.7.3_aarch64.dmg
```

Sanity test on a second Mac (or after clearing quarantine attributes): download
the DMG, open it, launch the app — no warning should appear.

---

## 5. CI — wire it into `build-desktop.yml`

The `macos-latest` matrix jobs already run `tauri-action`; it picks up signing
and notarisation automatically from environment variables. Nothing about the
build steps needs to change — just add secrets and env vars.

### 5a. Repo secrets

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Base64 of the `.p12`: `base64 -i camog-signing.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set on the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <your name> (<TEAMID>)` |
| `APPLE_ID` | Your Apple ID email *(Method A)* |
| `APPLE_PASSWORD` | App-specific password *(Method A)* |
| `APPLE_TEAM_ID` | Your Team ID *(Method A)* |

*(Method B instead: `APPLE_API_ISSUER`, `APPLE_API_KEY` (the key ID), and
`APPLE_API_KEY_PATH` pointing at the `.p8` — write the `.p8` to a temp file
from a base64 secret in a prior step.)*

`APPLE_CERTIFICATE` is special: **tauri-action imports it into a temporary
keychain on the runner itself** — no manual `security import` step needed.

### 5b. Workflow change

In `.github/workflows/build-desktop.yml`, extend the `env:` block of the
tauri-action step (line ~112):

```yaml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS signing + notarisation — tauri-action ignores these on non-macOS runners
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Both arch DMGs (`aarch64` and `x86_64`) are signed and notarised independently
by their matrix jobs. No other workflow changes required — the existing
`.dmg` upload/release globs already capture the artifacts.

---

## 6. Manual fallback (background knowledge)

If you ever need to do it by hand (debugging, re-signing a stray bundle):

```sh
APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Camog.app"
IDENTITY="Developer ID Application: <your name> (<TEAMID>)"

# 1. Sign the app bundle (hardened runtime is required for notarisation)
codesign --force --deep --options runtime --timestamp \
  --sign "$IDENTITY" "$APP"

# 2. Sign the DMG too (yes, DMGs get signed)
codesign --force --timestamp --sign "$IDENTITY" Camog_0.7.3_aarch64.dmg

# 3. Submit for notarisation (store credentials once, then submit)
xcrun notarytool store-credentials CAMOG_NOTARY \
  --apple-id "you@example.com" --team-id "XXXXXXXXXX" \
  --password "xxxx-xxxx-xxxx-xxxx"
xcrun notarytool submit Camog_0.7.3_aarch64.dmg --keychain-profile CAMOG_NOTARY --wait

# 4. Staple the approval ticket
xcrun stapler staple Camog_0.7.3_aarch64.dmg
```

Notes:

- `--deep` is a blunt instrument (signs nested code in discovery order) — it's
  fine for a Tauri app, which has no complex nested helper structure like
  Electron. Tauri's own bundler signs correctly without it.
- If notarisation fails, `xcrun notarytool log <submission-id>
  --keychain-profile CAMOG_NOTARY` returns a JSON report naming the exact
  file and reason.
- Rebuilds invalidate signatures — always sign the final artifact of a build,
  never sign then modify the bundle.

---

## 7. Checklist

- [ ] Developer Program joined, Team ID noted
- [ ] Developer ID Application certificate created and in keychain
- [ ] `.p12` exported and base64 copied into repo secrets
- [ ] Notarisation credentials (app-specific password or API key) in secrets
- [ ] `env:` block added to the macOS jobs in `build-desktop.yml`
- [ ] Local test build notarised and `spctl`-verified
- [ ] Release DMG opened clean on a second Mac
