# Camog — Clinical Photo Documentation

A desktop app (Tauri 2 + Next.js) for capturing clinical photos with patient
metadata. Photos are stored as JPEG files on disk; metadata lives in a local
SQLite database. Production target: Windows. Dev/test: macOS or Windows.

## Prerequisites

1. **Node.js 18+** and npm.
2. **Rust toolchain** — install via https://rustup.rs (one-time, ~5 GB with
   target toolchains).
3. **OS-specific Tauri dependencies:**
   - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
   - **Windows:** Microsoft Visual C++ Build Tools (or Visual Studio with the
     "Desktop development with C++" workload) and WebView2 (preinstalled on
     Windows 11; otherwise the Microsoft Edge WebView2 Runtime).

## Develop

```bash
npm install
npm run desktop
```

This runs `next dev --turbopack` (port 3434, so it can't collide with another
local Next app on 3000) and launches the Tauri window pointing at
`http://localhost:3434`. Camera requires `localhost` or HTTPS — the dev server
on `localhost` satisfies this.

> Browser-only iteration (no Rust rebuild): `npm run dev`. Note that storage
> calls (`@tauri-apps/plugin-sql` / `plugin-fs`) will fail outside the Tauri
> webview, so use this only for UI work.

## Build a native bundle

```bash
npm run desktop:build
```

Produces a platform-native installer in `src-tauri/target/release/bundle/`:
- macOS → `.dmg` / `.app`
- Windows → `.msi` / `.exe` (NSIS)

Cross-compiling OSes from one machine is not supported by Tauri; build on the
target OS or in CI (GitHub Actions matrix).

## Where data lives

The app uses Tauri's `appDataDir`:

| OS      | Path                                                        |
|---------|-------------------------------------------------------------|
| Windows | `C:\Users\<user>\AppData\Roaming\com.camog.app\`            |
| macOS   | `~/Library/Application Support/com.camog.app/`              |

- `camog.db` — SQLite database (patients, photos metadata, subparts, clinicians).
- `photos/<photoId>.jpg` — full-size JPEG (compressed to ≤1920px, quality 0.85).
- `photos/<photoId>.thumb.jpg` — 200×200 thumbnail.

### Photo storage location (local or cloud)

By default photo files live in the app data folder above. An admin can point
them anywhere else via **Settings → Storage**, including a cloud-synced folder
(OneDrive, Dropbox, iCloud Drive) — Camog writes JPEGs directly into that
folder. Changing the location copies existing photos across first (originals
are kept); the setting only flips after every copy succeeds. The database
always stays in the app data folder.

Photo rows in the DB store just the filename, so the library is portable: on
another machine, set the storage location to the same (synced) folder and the
photos resolve. Removing the custom folder (or deleting photos from it outside
Camog) makes those photos unreadable in the app — the DB metadata survives.

To reset everything: quit the app and delete the directory above.

## Architecture

| Layer       | Tech                                              |
|-------------|---------------------------------------------------|
| UI          | Next.js 15 (App Router, static export) + React 19 |
| Styling     | Tailwind CSS v4 + shadcn/ui (Radix primitives)    |
| Desktop     | Tauri 2 (Rust shell, registers SQL + FS plugins)  |
| Database    | SQLite via `@tauri-apps/plugin-sql`               |
| Photo files | JPEGs on disk via `@tauri-apps/plugin-fs`         |

Services (`lib/services/*`) are singletons consumed by React hooks; their
public API is preserved from the prior IndexedDB version, so components and
hooks are agnostic to the storage backend.

## Licensing

Camog uses offline, per-install licences (see
`specs/002-offline-licence/spec.md`). No server, no phone-home.

- **Model**: one licence per practice; tier (`solo` / `practice` / `clinic`),
  seat count, and expiry ride inside an Ed25519-signed payload. The app stores
  the key in its local SQLite `settings` row and re-verifies the signature on
  every read.
- **Trial**: first launch starts a 14-day trial.
- **After the trial / on expiry**: read-only mode — existing patients and
  photos stay viewable (records retention), but capturing, editing, and
  deletion are disabled until a key is activated (banner → Activate).

Issuing keys (vendor side; the private key lives in `.keys/`, gitignored):

```bash
node scripts/licence-keygen.mjs genkeys   # one-time vendor keypair
node scripts/licence-keygen.mjs issue --practice "Bay Dermatology" \
  --tier practice --seats 3 --months 12
node scripts/licence-keygen.mjs selftest  # format/verification checks
```

`--days N` replaces `--months` (negative N issues an already-expired key) when
testing the renewal banner, expiry rejection, and read-only states.

`genkeys` prints the public key to embed in `lib/licence/public-key.ts`; only
the paired private key can issue keys the app accepts.

## Scripts

| Script             | Purpose                                  |
|--------------------|------------------------------------------|
| `npm run dev`      | Next.js dev only (UI iteration)          |
| `npm run build`    | Static export to `out/`                  |
| `npm run desktop`  | Tauri dev (`next dev` + native window)   |
| `npm run desktop:build` | Tauri native bundle                |
| `npm run lint`     | ESLint                                   |
