// Staged database restore: the one-click "restore this backup" flow.
//
// The webview cannot swap camog.db under its own open connection pool
// (SQLITE_BUSY at best, corruption at worst — and Windows refuses to rename
// an open file outright), so the swap happens here at startup, before any
// connection — including the sql plugin's migrations — can open:
//
//   1. JS (backup-service.restoreDatabase) decrypts the chosen backup,
//      validates it (integrity + schema version, via the sql plugin opened
//      on the staged path), and stages it as {appConfigDir}/camog.restore
//      (tauri-plugin-sql resolves sqlite: paths against the config dir).
//   2. JS invokes restart_for_restore; the app relaunches.
//   3. apply_pending_restore runs in setup() before the webview loads: it
//      re-checks the staged file's header, moves the live camog.db (and its
//      -wal) aside as camog.pre-restore.db, and moves the staged file into
//      place. The pre-restore copy is the undo: quit Camog and swap it back
//      over camog.db to roll back a bad restore.

use std::fs;
use std::io::Read;
use std::path::Path;

use tauri::Manager;

#[cfg(not(debug_assertions))]
use crate::diagnostics;

const DB: &str = "camog.db";
const STAGED: &str = "camog.restore";
const PRE_RESTORE: &str = "camog.pre-restore.db";

/// The first 16 bytes of every SQLite database file.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

fn is_sqlite_file(path: &Path) -> bool {
    let Ok(mut f) = fs::File::open(path) else {
        return false;
    };
    let mut header = [0u8; 16];
    f.read_exact(&mut header).is_ok() && &header == SQLITE_MAGIC
}

fn sibling(name: &str, suffix: &str) -> String {
    format!("{name}{suffix}")
}

/// Swap a staged restore into place. Ok(None): nothing staged. Ok(Some):
/// swapped — the replaced database sits at camog.pre-restore.db. Err: a
/// staged file existed but was unusable — it is discarded and the live
/// database is untouched, so the caller logs and boots normally.
///
/// `config_dir` is the dir tauri-plugin-sql opens sqlite: paths in (equal
/// to the data dir on Windows/macOS, distinct on Linux) — the swap must
/// target the database the plugin actually opens.
///
/// Crash-safe by re-entry: every step is a rename, and a boot that finds
/// camog.restore present simply finishes the sequence — a crash between
/// renames leaves either the old or the new database at camog.db, never a
/// half-written mix.
pub fn apply_pending_restore(config_dir: &Path) -> Result<Option<()>, String> {
    let staged = config_dir.join(STAGED);
    if !staged.exists() {
        return Ok(None);
    }

    // A staged file that isn't SQLite means staging was interrupted or the
    // file was tampered with. It is decrypted data sitting in the open —
    // discard it rather than swap garbage over the live database.
    if !is_sqlite_file(&staged) {
        let _ = fs::remove_file(config_dir.join(sibling(STAGED, "-wal")));
        let _ = fs::remove_file(config_dir.join(sibling(STAGED, "-shm")));
        let _ = fs::remove_file(&staged);
        return Err("staged restore was not a valid database — discarded".into());
    }

    let live = config_dir.join(DB);
    if live.exists() {
        // Stale safety copies from an earlier restore are replaced by this
        // one (one pre-restore copy is kept, mirroring the single live
        // database). Only when a live database is being moved aside — after
        // an interrupted swap there is no live database and the existing
        // pre-restore copy IS the user's data, not a stale leftover.
        let _ = fs::remove_file(config_dir.join(sibling(PRE_RESTORE, "-wal")));
        let _ = fs::remove_file(config_dir.join(PRE_RESTORE));
        fs::rename(&live, config_dir.join(PRE_RESTORE))
            .map_err(|e| format!("could not move the live database aside: {e}"))?;
    }
    // A surviving -wal belongs to the old file: keep it beside the safety
    // copy so the pre-restore database is complete. The -shm is ephemeral.
    let wal = config_dir.join(sibling(DB, "-wal"));
    if wal.exists() {
        fs::rename(&wal, config_dir.join(sibling(PRE_RESTORE, "-wal")))
            .map_err(|e| format!("could not move the live database's -wal aside: {e}"))?;
    }
    let _ = fs::remove_file(config_dir.join(sibling(DB, "-shm")));
    // Siblings the staging-side validation may have created on the staged
    // file; the staged database is self-contained after a clean close.
    let _ = fs::remove_file(config_dir.join(sibling(STAGED, "-wal")));
    let _ = fs::remove_file(config_dir.join(sibling(STAGED, "-shm")));

    fs::rename(&staged, &live)
        .map_err(|e| format!("could not move the staged restore into place: {e}"))?;
    Ok(Some(()))
}

/// Relaunch the app so the pending staged restore is applied at boot.
/// Fails (without restarting) when nothing valid is staged. Never returns
/// on success — the process exits and a fresh instance takes over. A dev
/// build never restarts at all (see below); the staged restore is applied
/// at the next manual launch either way.
#[tauri::command]
pub fn restart_for_restore(app: tauri::AppHandle) -> Result<(), String> {
    // The config dir — the base tauri-plugin-sql opens sqlite: paths in —
    // so this checks the same file the boot swap (and JS validation) uses.
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("could not resolve the app config folder: {e}"))?;
    let staged = dir.join(STAGED);
    if !staged.exists() {
        return Err("No restore is staged.".into());
    }
    if !is_sqlite_file(&staged) {
        return Err("The staged restore file is not a valid database.".into());
    }
    // A dev build runs under `tauri dev`: restarting exits the child, tauri
    // dev tears the dev server down with it, and the restarted binary loads
    // its webview from that now-dead server — a white screen that reads as
    // a crash. The staged file survives; the boot swap applies the restore
    // at the next manual launch, so dev stops at a quit-and-reopen.
    #[cfg(debug_assertions)]
    return Err("Restore staged — quit and reopen Camog to finish it.".into());
    #[cfg(not(debug_assertions))]
    {
        diagnostics::record(
            diagnostics::Level::Info,
            "db-restore",
            "Restarting to apply a staged database restore",
            None,
        );
        app.restart()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "camog-restore-{}-{}-{}",
            name,
            std::process::id(),
            rand::random::<u64>()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write(path: &Path, contents: &[u8]) {
        fs::write(path, contents).expect("write fixture");
    }

    /// A plausible SQLite file: magic header plus a distinguishing payload.
    fn sqlite_file(payload: &str) -> Vec<u8> {
        let mut bytes = SQLITE_MAGIC.to_vec();
        bytes.extend_from_slice(payload.as_bytes());
        bytes
    }

    #[test]
    fn no_staged_file_is_a_noop() {
        let dir = tempdir("noop");
        write(&dir.join(DB), &sqlite_file("live"));
        assert_eq!(apply_pending_restore(&dir), Ok(None));
        assert!(dir.join(DB).exists());
        assert!(!dir.join(PRE_RESTORE).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn staged_restore_replaces_live_db_and_keeps_it_aside() {
        let dir = tempdir("swap");
        write(&dir.join(DB), &sqlite_file("live-old"));
        write(&dir.join(sibling(DB, "-wal")), b"old-wal");
        write(&dir.join(sibling(DB, "-shm")), b"old-shm");
        write(&dir.join(STAGED), &sqlite_file("backup-new"));
        // A stale safety copy from an earlier restore must be replaced.
        write(&dir.join(PRE_RESTORE), &sqlite_file("ancient"));
        write(&dir.join(sibling(PRE_RESTORE, "-wal")), b"ancient-wal");

        assert_eq!(apply_pending_restore(&dir), Ok(Some(())));

        assert_eq!(fs::read(dir.join(DB)).unwrap(), sqlite_file("backup-new"));
        assert_eq!(fs::read(dir.join(PRE_RESTORE)).unwrap(), sqlite_file("live-old"));
        assert_eq!(
            fs::read(dir.join(sibling(PRE_RESTORE, "-wal"))).unwrap(),
            b"old-wal"
        );
        assert!(!dir.join(sibling(DB, "-shm")).exists());
        assert!(!dir.join(STAGED).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_sqlite_staged_file_is_discarded_and_live_db_survives() {
        let dir = tempdir("garbage");
        write(&dir.join(DB), &sqlite_file("live-old"));
        write(&dir.join(STAGED), b"not a database at all");
        write(&dir.join(sibling(STAGED, "-wal")), b"junk");

        assert!(apply_pending_restore(&dir).is_err());

        assert_eq!(fs::read(dir.join(DB)).unwrap(), sqlite_file("live-old"));
        assert!(!dir.join(STAGED).exists());
        assert!(!dir.join(sibling(STAGED, "-wal")).exists());
        assert!(!dir.join(PRE_RESTORE).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn completes_the_swap_after_a_crash_between_renames() {
        // A previous boot died after moving camog.db aside but before moving
        // the staged file in: camog.db is absent, the safety copy and the
        // staged file are both in place. Finishing the sequence is the only
        // correct outcome — a fresh empty database must not be created.
        let dir = tempdir("crash-window");
        write(&dir.join(PRE_RESTORE), &sqlite_file("live-old"));
        write(&dir.join(STAGED), &sqlite_file("backup-new"));

        assert_eq!(apply_pending_restore(&dir), Ok(Some(())));

        assert_eq!(fs::read(dir.join(DB)).unwrap(), sqlite_file("backup-new"));
        assert_eq!(fs::read(dir.join(PRE_RESTORE)).unwrap(), sqlite_file("live-old"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_works_with_no_prior_database() {
        // First run on a fresh machine that restores a backup before any
        // camog.db ever existed: nothing to keep aside, staged file moves in.
        let dir = tempdir("first-run");
        write(&dir.join(STAGED), &sqlite_file("backup-new"));

        assert_eq!(apply_pending_restore(&dir), Ok(Some(())));

        assert_eq!(fs::read(dir.join(DB)).unwrap(), sqlite_file("backup-new"));
        assert!(!dir.join(PRE_RESTORE).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
