# Camog macOS User Guide

Installing and using Camog on macOS — for everyone. Developer instructions are
at the bottom and are **not** needed to install or run the app.

## Install Camog (end users)

The Camog installer is self-contained. The app, its interface, and the
database engine are all bundled — you do **not** need Node.js, Rust, or any
other tools on the machine.

1. Download the latest installer from
   [github.com/jsaenz03/camorg/releases](https://github.com/jsaenz03/camorg/releases):
   - `Camog_*_aarch64.dmg` — Macs with Apple Silicon (M1/M2/M3/M4)
   - `Camog_*_x64.dmg` — Intel Macs
   - (Windows machines: use the `.msi` — its setup wizard also installs the
     WebView2 component automatically if the machine is missing it)
2. Open the `.dmg` and drag **Camog** into **Applications**
3. Launch Camog from Applications
   - On first launch, macOS may warn that the app is from an unidentified
     developer (the app is not yet code-signed). Right-click Camog →
     **Open** → **Open** in the dialog. This is only needed once.
4. The first-run wizard appears: name your organisation and create the first
   account — it becomes the organisation administrator
5. Sign in with the account you just created

That's the entire setup. To add more members, the administrator invites or
approves them under **Settings → Users** (see below).

### Adding people (administrator)

- **Invitations** (Settings → Invitations): generate a code, hand it to the
  new member, they sign up with it and choose their own passcode
- **Public sign up**: if enabled (Settings → App settings), anyone can
  request access from the sign-in screen; their account stays **pending**
  until an administrator approves it in Settings → Users
- Administrators set each member's role (admin / clinician) and can
  deactivate accounts at any time

## Data Locations

All data stays on this Mac:

**Main directory:** `~/Library/Application Support/com.camog.app/`

- `camog.db` — SQLite database (patients, photos metadata, users)
- `photos/` — full-size JPEGs and thumbnails (unless relocated via
  Settings → Storage)

## Maintenance

### Backup

```bash
cp -r ~/Library/Application\ Support/com.camog.app/ ~/camog-backup/
```

(Settings → Storage can also point photos at a cloud-synced folder.)

### Reset (deletes ALL data)

```bash
rm -rf ~/Library/Application\ Support/com.camog.app/
```

The next launch shows the first-run wizard again.

### Update

Download the newer `.dmg` from
[Releases](https://github.com/jsaenz03/camorg/releases) and drag it over the
existing app in Applications. Your data is untouched.

## Troubleshooting

### Cannot sign in
1. Fresh install with no accounts: the sign-in screen links to **Sign up** —
   the first account created becomes the administrator
2. "Awaiting administrator approval": a new sign-up needs approval in
   Settings → Users first
3. "This account has been deactivated": an administrator must re-enable it
4. Verify the database exists at
   `~/Library/Application Support/com.camog.app/camog.db`

### Camera not working
- Ensure camera permission is granted to Camog in System Settings → Privacy
  & Security → Camera
- Check the camera is not in use by another application

### App won't start
1. Confirm macOS 10.15 (Catalina) or newer
2. If Gatekeeper blocks launch, right-click → Open (see install step 3)
3. If the database is corrupted, reset it (see Maintenance) — this deletes
   all data

## Security notes

- Passcodes are stored as PBKDF2 hashes (210k iterations, per-user salt) —
  never plaintext
- Local SQLite storage only; nothing is transmitted off the device
- Production installs have no default credentials — the first account is
  created by whoever sets up the organisation

---

## Developer setup (only for building from source)

Skip everything here if you installed from a `.dmg`/`.msi`.

### Prerequisites
1. **Node.js 18+** — [nodejs.org](https://nodejs.org/)
2. **Rust toolchain:**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```

### Run in dev mode
```bash
cd /path/to/camog
npm install
npm run desktop
```

On a fresh database, dev mode also creates a default admin from `.env` (copy
`.env.example`; defaults `admin` / `devpass123`). Production builds never
read `.env` — packaged apps use the first-run wizard instead.

### Build the installers locally
```bash
npm run desktop:build
```

Output lands in `src-tauri/target/release/bundle/`. CI (GitHub Actions)
builds and attaches the signed-off macOS DMGs and Windows MSI to each
[Release](https://github.com/jsaenz03/camorg/releases) automatically.

> **Warning:** a local `.env` with bootstrap credentials gets baked into a
> locally built installer (Next inlines `NEXT_PUBLIC_*` values at build
> time). Move `.env` aside before building installers you intend to
> distribute — CI builds are always clean.

### Configuration
- `.env` — dev-only bootstrap admin credentials
- `src-tauri/tauri.conf.json` — window, security, and bundle settings

### Dev vs production
- Dev: hot reload, verbose errors, `.env` bootstrap admin
- Production: optimised build, first-run organisation wizard, no default
  credentials
