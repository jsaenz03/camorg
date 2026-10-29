# camog Development Guidelines

Updated: 29 Sep 2026 (v0.9.0)

## What this is
Camog — local-first clinical photography for Australian GPs. A desktop app:
Tauri 2 shell (Rust backend) around a Next.js 15 App Router UI (React 19,
TypeScript 5, Tailwind CSS v4, shadcn/ui-style primitives). Patient data
stays on-device: SQLite via `@tauri-apps/plugin-sql`, photos encrypted by
the Rust layer with provenance records. Licences are validated against a
Cloudflare Worker (`activation-server/`).

## Project structure
- `app/` — Next.js routes: `(auth)` login/signup; `(dashboard)` patients,
  photos, compare, settings
- `components/` — `ui/` primitives plus feature components (camera, capture,
  photo, patient, licence, settings, dashboard…)
- `lib/` — client logic: `db/`, `photo/`, `licence/`, `auth/`, `storage/`,
  `validators/`, `diagnostics`, `utils/`
- `src-tauri/` — Rust backend: `photo_crypto`, `provenance`,
  `licence_device`, `licence_activation`, `report` (case-report PDF +
  email handoff), `remote_camera` (+ `remote_camera_page`), `diagnostics`,
  `db_restore`; SQLite migrations in `src-tauri/migrations`
- `activation-server/` — Cloudflare Worker for licence activation
- `legal/`, `marketing/`, `installers/`, `guide/` — docs and packaging assets
- CI: `.github/workflows/build-desktop.yml`, `msix-test.yml`

## Commands
- `npm run dev` — Next.js dev server on port 3434
- `npm run desktop` — `tauri dev` (desktop shell)
- `npm run desktop:build` — packaged desktop build
- `npm run lint` — eslint
- `npm test` — Playwright e2e
- `npm run preview` / `deploy` / `upload` — OpenNext build on Cloudflare
- Rust (from `src-tauri/`): `cargo check`, `cargo clippy` — clippy must stay
  green; **never run `cargo fmt`** (formatting is deliberately not applied)

## Code style
- TypeScript/React: follow existing conventions; user-facing copy uses
  Australian English and DD/MM/YYYY dates
- Rust: match existing module style; keep clippy clean

<!-- MANUAL ADDITIONS START -->

## Releases convention

- Every push to `main` that passes CI publishes a rolling **Edge** pre-release
  (tag `edge`) with all four installers — the GitHub Releases page always
  reflects the latest packaged build. The `edge` release is recreated each run,
  never accumulated.
- Stable releases: bump `version` in **all three** of `package.json`,
  `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (the last drives
  CARGO_PKG_VERSION, shown in Settings → Diagnostics; missing it ships an app
  that reports the previous version), commit, then publish a GitHub Release
  tagged `vX.Y.Z` — CI builds and attaches the installers to it.

## Windows specifics

- Any console child process (manage-bde, powershell, reg, …) spawned from the
  GUI **must** set `CREATE_NO_WINDOW` — see the `silent()` helper in
  `diagnostics.rs`. Without it each spawn flashes a console window over the
  app.
- Disk-encryption probe (`diagnostics.rs`): `manage-bde -status` works
  unelevated on Pro/Enterprise; on **Windows Home no non-admin query exists
  at all** (manage-bde demands elevation, the BitLocker cmdlet/WMI are
  absent) — the probe returns the `home` state and the UI points at
  Settings → Device encryption. Never return a guessed on/off.
- Phone-link firewall: the inbound rule ("Camog phone link") is all-profiles
  (Private + Public) by design, scoped to LocalSubnet + Tailscale's
  100.64.0.0/10. Store installs / declined UAC get Windows' Private-only
  dialog rule instead; `installers/repair-phone-link-firewall.ps1` (run as
  admin) recreates the correct rule without a reinstall.

## Approved roadmap

- `specs/006-signed-update-channel` — **SHIPPED as 0.12.0** (30 Oct): tauri
  updater, Windows-only via tauri.windows.conf.json, NSIS served from the
  channel (MSI + macOS + Store stay manual), signing keys only as GitHub
  secrets. spec.md records the details; the real-box update test on a
  Windows machine is still outstanding.
- `specs/007-qr-keyed-link-crypto` — **SHIPPED as 0.13.0** (30 Oct):
  AES-256-GCM transit envelope over every patient-data record on the phone
  link, keyed from the QR's `?k=` (rotated with the pairing code). Two
  platform-forced deviations, recorded in spec.md: no WebCrypto (embedded
  JS GCM, OpenSSL cross-verified) and no service worker (ETag-revalidated
  shell) — both are secure-context-only and the link is plain HTTP.
  Tailscale path untouched.
<!-- MANUAL ADDITIONS END -->
