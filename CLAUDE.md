# camog Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-10-08

## Active Technologies
- TypeScript 5.x with Next.js 15.5.4, React 19.1.0 + Next.js (App Router), React, Tailwind CSS v4, shadcn/ui (to be added) (001-role-you-are)

## Project Structure
```
src/
tests/
```

## Commands
npm test [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] npm run lint

## Code Style
TypeScript 5.x with Next.js 15.5.4, React 19.1.0: Follow standard conventions

## Recent Changes
- 001-role-you-are: Added TypeScript 5.x with Next.js 15.5.4, React 19.1.0 + Next.js (App Router), React, Tailwind CSS v4, shadcn/ui (to be added)

<!-- MANUAL ADDITIONS START -->

## Releases convention

- Every push to `main` that passes CI publishes a rolling **Edge** pre-release
  (tag `edge`) with all four installers — the GitHub Releases page always
  reflects the latest packaged build. The `edge` release is recreated each run,
  never accumulated.
- Stable releases: bump `version` in both `package.json` and
  `src-tauri/tauri.conf.json`, commit, then publish a GitHub Release tagged
  `vX.Y.Z` — CI builds and attaches the installers to it.
<!-- MANUAL ADDITIONS END -->