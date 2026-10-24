//! The backup passphrase, kept in the OS credential store (macOS Keychain /
//! Windows Credential Manager) under com.camog.app/backup-passphrase.
//! Automatic backup needs the passphrase without a prompt, and it must not
//! live in the database it protects — a restore swaps that database
//! wholesale, so a setting inside it would revert with every restore.

const PASSPHRASE_SERVICE: &str = "com.camog.app";
const PASSPHRASE_USER: &str = "backup-passphrase";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(PASSPHRASE_SERVICE, PASSPHRASE_USER)
        .map_err(|e| format!("Could not open the OS credential store ({e})."))
}

/// The passphrase saved for automatic backups, or None when nothing is
/// stored (or the store has nothing usable — the same tolerance as the
/// photo-key rescue read, which must not nag over an unavailable store).
#[tauri::command]
pub fn backup_passphrase_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(passphrase) => Ok(Some(passphrase)),
        Err(keyring::Error::NoEntry) | Err(keyring::Error::PlatformFailure(_)) => Ok(None),
        Err(e) => Err(format!(
            "Could not read the backup passphrase from the OS credential store ({e})."
        )),
    }
}

#[tauri::command]
pub fn backup_passphrase_set(passphrase: String) -> Result<(), String> {
    entry()?
        .set_password(&passphrase)
        .map_err(|e| format!("Could not save the backup passphrase to the OS credential store ({e})."))
}

/// Best effort: an already-absent entry is the forgotten state.
#[tauri::command]
pub fn backup_passphrase_delete() -> Result<(), String> {
    match entry()?.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Could not remove the backup passphrase from the OS credential store ({e})."
        )),
    }
}
