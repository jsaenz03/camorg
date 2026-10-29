# Spec 006 — signed update channel (Windows-first)

Approved 30 Oct 2026. **Shipped as 0.12.0** (shipped 30 Oct 2026; 007 follows).

## What shipped

- Keypair generated with `npm run tauri signer generate`; the private key and
  its password live only as the GitHub Actions secrets
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  (write-only by design — GitHub cannot read them back). The local key file
  was destroyed after `gh secret set`. Consequence, per the spec's own
  warning: losing the key bricks the channel and rotation ships as a new app
  version.
- `src-tauri/tauri.windows.conf.json` carries `bundle.createUpdaterArtifacts`
  and the whole `plugins.updater` block (endpoint
  `https://github.com/jsaenz03/camorg/releases/latest/download/latest.json`,
  pubkey, `installMode: "passive"`). Platform-specific config means macOS
  builds literally have no updater — macOS ships disabled, as scoped.
- Verified per the design's §6: tauri v2 *signs* both NSIS `.exe` and
  `.msi`, but the channel serves the **NSIS** installer
  (`updaterJsonPreferNsis: true` in the workflow) — WiX MSI installs keep
  manual updates. Documented in `guide/practice-it-responsibilities.md` §5.
- Store guard: `updater_allowed` command in `lib.rs` — an exe path
  containing `WindowsApps` (and any unreadable path) returns false and the
  service never checks. ponytail: substring check; upgrade path =
  package-identity API.
- UX: `lib/services/update-service.ts` + `components/settings/updates-card.tsx`
  (Settings → Diagnostics, all users). Automatic check on dashboard mount at
  most once a day (localStorage stamp); offers are toasts; install =
  explicit click → progress → second explicit click to relaunch. Never
  silent. `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` on
  both sides; `updater:default` + `process:default` capabilities; CSP
  untouched (the plugin fetches from Rust, not the webview).
- CI: only the Windows matrix leg receives the signing secrets and runs
  `includeUpdaterJson`; `latest.json` is uploaded to the release, which only
  exists on stable `vX.Y.Z` publishes — edge pushes have nothing to attach
  to, so the rolling edge can never serve a pre-release manifest.
- Tests: `updater_signature_tests` in `lib.rs` drive the same
  `minisign_verify` calls the updater crate makes — valid signature passes,
  one flipped byte rejects, the configured pubkey/endpoint parse (endpoint
  must be the `releases/latest/download` form). Post-release, the published
  `latest.json` + `.exe.sig` are verified against the config pubkey as the
  real-artifact negative test (planned for v0.12.0 immediately after the
  release publishes; result recorded at the bottom of this file).

## Deviations / notes

- The "real-box test: point a test install at a test manifest, take one
  update" acceptance item remains a **manual Windows test** (no Windows box
  is drivable from the dev machine; jsaenz-desktop has no sshd). Outstanding
  until someone runs one update end to end on jsaenz-desktop.

## Problem

There is no auto-update path: no updater plugin, no signing secrets, no
manifest. Patching is manual (Store for MSIX, reinstall for direct
installs), so version currency on machines holding PHI is the practice's
problem. The installed base up to 0.11.0 has no updater — they take exactly
one more manual update before notifications can reach them.

## Verified facts (29 Oct 2026 — do not re-derive)

- CI (`build-desktop.yml`) builds on every push to `main` + every `release:
  published`: dmg ×2 (macOS), NSIS `.exe` + `.msi` (Windows), and recreates
  the rolling `edge` release. Stable releases = `vX.Y.Z` tags; CI attaches
  the installers to the GitHub Release.
- MSIX/Store packaging happens **outside** tauri (`scripts/make-msix.ps1`);
  the Store handles those updates itself — the updater must never touch a
  Store install.
- No `.app.tar.gz` updater artifacts are produced today; the macOS updater
  additionally requires Apple Developer ID signing + notarisation, which the
  builds don't have (`MACOS_SIGNING_GUIDE.md` exists for when that day
  comes). **macOS ships disabled in this spec's scope.**

## Design

1. Keys: `npm run tauri signer generate` once; store
   `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as
   GitHub Actions secrets only. Losing the key bricks the channel; rotation
   means shipping a new app version.
2. Build: enable `createUpdaterArtifacts` (bundle config) + updater secrets
   in the workflow. Windows produces the signed NSIS artifact.
3. Manifest: generate `latest.json` **only on `vX.Y.Z` release builds** —
   never on edge pushes, so stable users can never auto-take a pre-release.
   Endpoint = the GitHub Release asset URL for `latest.json`.
4. Store guard: an install whose exe path contains `WindowsApps` never runs
   the updater (ponytail check; upgrade path = package-identity API).
5. UX: Settings gains "Check for updates"; an automatic check runs on launch
   at most once a day, and **always asks before installing** — download +
   verify signature + relaunch, never silent. The updater plugin is inert
   unless invoked.
6. At implementation, verify whether the tauri v2 updater installs MSI or
   NSIS-only; if NSIS-only, document that MSI-installed machines keep manual
   updates (the IT doc says so).

## Acceptance

- A tampered artifact fails signature verification (negative test).
- A `WindowsApps` path no-ops the updater.
- Edge pushes never publish `latest.json`.
- Real-box test: point a test install at a test manifest, take one update.
- CI green; edge flow unchanged.

## Regression watch

- Do not gate the `checks` job on the updater; do not slow the build matrix.
- The updater plugin registers commands — keep the CSP unchanged.
