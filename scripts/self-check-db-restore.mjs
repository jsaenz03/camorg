// Self-check for the staged database-restore flow (one-click restore).
// Run: node scripts/self-check-db-restore.mjs
//
// The restore spans three files that must agree without a compiler watching:
//   - backup-service.ts stages 'camog.restore' and refuses backups whose
//     schema (LATEST_MIGRATION_VERSION) is newer than the app can open;
//   - src-tauri/src/db_restore.rs swaps that exact filename in at boot and
//     keeps the replaced database as camog.pre-restore.db;
//   - types/audit.ts must carry the 'backup.restore' action and its label.
// This script fails the build when any of those drift.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const lib = read('../src-tauri/src/lib.rs');
const restoreRs = read('../src-tauri/src/db_restore.rs');
const service = read('../lib/services/backup-service.ts');
const audit = read('../types/audit.ts');

// 1. The TS schema ceiling matches the newest Rust migration. If lib.rs
//    gains migration 21 and the constant stays 20, an old build would stage
//    a backup it can't open — bricking the app at the next launch.
const versions = [...lib.matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1]));
assert.ok(versions.length > 0, 'no migrations found in lib.rs');
const latest = Math.max(...versions);
const pinned = service.match(/LATEST_MIGRATION_VERSION\s*=\s*(\d+)/);
assert.ok(pinned, 'LATEST_MIGRATION_VERSION missing from backup-service.ts');
assert.equal(
  Number(pinned[1]),
  latest,
  `backup-service.ts pins schema ${pinned[1]} but lib.rs migrations reach ${latest}`,
);

// 2. The staged filename is a contract between TS staging and the Rust swap.
assert.match(service, /'camog\.restore'/, 'backup-service must stage camog.restore');
assert.match(restoreRs, /"camog\.restore"/, 'db_restore.rs must swap camog.restore');
assert.match(
  restoreRs,
  /"camog\.pre-restore\.db"/,
  'db_restore.rs must keep the replaced database as camog.pre-restore.db',
);

// 3. The swap is wired: applied in setup before the webview loads, and the
//    restart command is registered.
assert.match(lib, /db_restore::apply_pending_restore/, 'setup must apply a pending restore');
assert.match(lib, /db_restore::restart_for_restore/, 'restart command must be registered');

// 4. The audit action and its human label are both registered.
assert.match(audit, /'backup\.restore'\n/, 'backup.restore action missing from the union');
assert.match(audit, /'backup\.restore':\s*'/, 'backup.restore label missing');

// 5. Staging (TS), validation (Database.load) and the boot swap (Rust) must
//    all sit in the directory tauri-plugin-sql resolves sqlite: paths
//    against — the app CONFIG dir. It equals the data dir on Windows/macOS
//    but not on Linux, and a divergence would validate one file and swap
//    another.
assert.match(service, /appConfigDir\(\)/, 'staging must resolve appConfigDir()');
assert.match(restoreRs, /app_config_dir\(\)/, 'restart_for_restore must resolve app_config_dir()');
assert.match(lib, /app_config_dir\(\)/, 'setup must pass app_config_dir() to the swap');

// 6. The restart must be gated off in dev builds: under `tauri dev` a
//    restart orphans the new process with the dev server dead (white
//    screen). Only the not(debug_assertions) branch may call app.restart().
assert.match(
  restoreRs,
  /#\[cfg\(not\(debug_assertions\)\)\]\s*\{[^}]*app\.restart\(\)/s,
  'app.restart() must sit inside the not(debug_assertions) branch',
);

// 7. The restore confirmation dialog: Tauri v2 patches window.confirm into
//    an async plugin call that (a) needs dialog:allow-confirm — dialog:default
//    doesn't include it — and (b) returns a truthy rejected promise, so a
//    synchronous guard silently passes. Every confirm gate must go through
//    lib/utils/confirm.ts, and the capability must grant the permission.
const caps = JSON.parse(read('../src-tauri/capabilities/default.json'));
assert.ok(
  caps.permissions.includes('dialog:allow-confirm'),
  'capabilities must grant dialog:allow-confirm for the restore confirmation',
);
const panel = read('../components/settings/backup-panel.tsx');
assert.match(panel, /confirmDialog\(/, 'backup panel must confirm via confirmDialog');

const offenders = [];
const walk = (abs) => {
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = join(abs, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(tsx?|mjs)$/.test(e.name) || e.name === 'confirm.ts') continue;
    if (/window\.confirm\(/.test(readFileSync(p, 'utf8'))) offenders.push(p);
  }
};
for (const w of ['../app', '../components', '../lib'])
  walk(new URL(w, import.meta.url).pathname);
assert.deepEqual(offenders, [], 'window.confirm guards must use confirmDialog (broken under Tauri): ' + offenders.join(', '));

// 8. The sign-in-screen recovery path (locked-out admin). Restoring a backup
//    alone would bring back the passcode hashes nobody remembers, so the
//    recovery method must reset admin passcodes inside the staged database —
//    and it must NOT require an admin, because nobody can sign in. The
//    login screen must gate the restart on the user saving the one-time
//    temporary passcode (the restart exits the app). The factory reset must
//    clear a staged restore (else "delete all data" resurrects it at the
//    next boot) while staying destructive for the backups themselves.
const login = read('../app/(auth)/login/page.tsx');
const authServiceSrc = read('../lib/services/auth-service.ts');
assert.match(
  service,
  /async restoreForPasscodeRecovery\(/,
  'backup-service must expose restoreForPasscodeRecovery',
);
const recoveryMethod = service.split('async restoreForPasscodeRecovery(')[1] ?? '';
assert.doesNotMatch(
  recoveryMethod.split('restartForRestore')[0],
  /requireAdmin/,
  'restoreForPasscodeRecovery must not require an admin — nobody can sign in',
);
assert.match(
  recoveryMethod,
  /must_change_passcode = 1/,
  'recovery must force a passcode change at first sign-in',
);
assert.match(
  service,
  /async restartForRestore\(/,
  'backup-service must expose restartForRestore (recovery restarts only after the passcode is acknowledged)',
);
assert.match(login, /restoreForPasscodeRecovery/, 'the login screen must offer the recovery restore');
assert.match(login, /restartForRestore/, 'the login screen must restart via restartForRestore');
assert.match(
  login,
  /recoverySaved/,
  'the recovery restart must be gated on saving the temporary passcode',
);
assert.match(
  authServiceSrc,
  /camog\.restore/,
  'factory reset must clear a staged restore (camog.restore) or it resurrects the wiped data at next boot',
);
assert.match(
  authServiceSrc,
  /camog-backup-\\d\{14\}/,
  'factory reset must keep deleting photos-folder backups — the destructive path must stay destructive',
);
assert.match(
  authServiceSrc,
  /private async removeStagedRestore\(/,
  'staged-restore cleanup must be centralised in auth-service',
);
assert.ok(
  (authServiceSrc.match(/this\.removeStagedRestore\(\)/g) ?? []).length >= 2,
  'both the factory reset AND a successful login must cancel a staged recovery restore — a stage left in place rolls the database back at the next launch',
);

console.log('db-restore self-check passed');
