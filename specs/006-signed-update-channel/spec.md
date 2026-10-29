# Spec 006 — signed update channel (Windows-first)

Approved 30 Oct 2026. Ship as **0.12.0** (its own release; 007 ships after).

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
