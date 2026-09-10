// Camog Tauri shell. Storage is delegated to tauri-plugin-sql (SQLite) and
// tauri-plugin-fs (photo files). App-level Rust commands: photo-directory
// scope grants and the phone-camera tether server.

mod diagnostics;
mod db_restore;
mod licence_activation;
mod licence_device;
mod photo_crypto;
mod provenance;
mod remote_camera;
mod report;

use std::path::{Component, Path};

use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};
use tauri_plugin_fs::FsExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // ponytail: migrations inline here. If the count grows, move to a migrations/ dir.
  let migrations = vec![
    Migration {
      version: 1,
      description: "create initial tables",
      sql: include_str!("../migrations/001_init.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "auth: roles, invitations, settings",
      sql: include_str!("../migrations/002_auth.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "access control: patient owner, org-share, doctor grants",
      sql: include_str!("../migrations/003_access_control.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "storage: configurable photos directory",
      sql: include_str!("../migrations/004_storage.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "signup approval: pending accounts, public signup on",
      sql: include_str!("../migrations/005_signup_approval.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "patients: optional date of birth",
      sql: include_str!("../migrations/006_patient_dob.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 7,
      description: "consent tracking, audit log, idle privacy lock",
      sql: include_str!("../migrations/007_consent_audit.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 8,
      description: "licence: signed key storage, trial stamp, install ID",
      sql: include_str!("../migrations/008_licence.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 9,
      description: "branding: business logo and colour palette",
      sql: include_str!("../migrations/009_branding.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 10,
      description: "reviews: patient review dates, alert windows",
      sql: include_str!("../migrations/010_reviews.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 11,
      description: "photos: laterality (left/right side of the patient)",
      sql: include_str!("../migrations/011_laterality.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 12,
      description: "auth: open public signup by default (invite codes optional)",
      sql: include_str!("../migrations/012_open_signup_default.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 13,
      description: "photos: per-photo review stamps + lesion series grouping",
      sql: include_str!("../migrations/013_photo_review_series.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 14,
      description: "photos: scheduled review dates (dashboard alerts per photo)",
      sql: include_str!("../migrations/014_photo_review_due.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 15,
      description: "photos: per-photo result files (PDF/RTF/… documents)",
      sql: include_str!("../migrations/015_result_files.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 16,
      description: "photos: exact pinpoint mark (X) on the body map",
      sql: include_str!("../migrations/016_photo_pinpoint.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 17,
      description: "photos: which face (front/back) the pinpoint X was marked on",
      sql: include_str!("../migrations/017_photo_pin_view.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 18,
      description: "audit: patient name stored per row (survives renames/deletes)",
      sql: include_str!("../migrations/018_audit_patient_name.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 19,
      description: "audit: legacy patient rows attributed, photo labels snapshot",
      sql: include_str!("../migrations/019_audit_identity_backfill.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 20,
      description: "licence: activation token (server-side seat enforcement)",
      sql: include_str!("../migrations/020_licence_activation.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 21,
      description: "photos: body part optional (inherited when linked into a series)",
      sql: include_str!("../migrations/021_photo_body_part_optional.sql"),
      kind: MigrationKind::Up,
    },
  ];

  // Grants the fs plugin runtime access to a user-chosen photo directory
  // (e.g. a cloud-synced folder outside the app data dir). Capability scopes
  // are static, so a persisted custom dir must be re-granted on every launch.
  #[tauri::command]
  fn grant_directory_access(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // Every refusal is recorded so Settings → Diagnostics can explain why a
    // custom photos folder stopped working.
    let deny = |msg: String| -> Result<(), String> {
      diagnostics::record(diagnostics::Level::Error, "grant-directory", &msg, None);
      Err(msg)
    };
    // Trust boundary: the webview supplies this string (normally via the
    // native folder dialog). Refuse anything but an existing, non-root,
    // non-home directory so a compromised webview can't hand the fs scope
    // to the whole disk.
    let p = Path::new(&path);
    if !p.is_absolute() {
      return deny("Path must be absolute".into());
    }
    // A path with no Normal component is a filesystem root ("/", "C:\\",
    // UNC share roots).
    if !p.components().any(|c| matches!(c, Component::Normal(_))) {
      return deny("Refusing to grant a filesystem root".into());
    }
    if let Ok(home) = app.path().home_dir() {
      if p == home {
        return deny("Refusing to grant the user's home directory".into());
      }
    }
    let meta = match std::fs::metadata(p) {
      Ok(meta) => meta,
      Err(e) => return deny(format!("Directory not accessible: {e}")),
    };
    if !meta.is_dir() {
      return deny("Path is not a directory".into());
    }
    app
      .fs_scope()
      .allow_directory(&path, true)
      .map_err(|e| {
        let msg = format!("Could not grant access to the folder: {e}");
        diagnostics::record(diagnostics::Level::Error, "grant-directory", &msg, None);
        msg
      })
  }

  tauri::Builder::default()
    // Second launch focuses the existing window instead of opening a second
    // process on the same SQLite file (split-brain UI + SQLITE_BUSY writes).
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(webview) = app.get_webview_window("main") {
        let _ = webview.unminimize();
        let _ = webview.set_focus();
      }
    }))
    .setup(|app| {
      diagnostics::install_panic_hook();
      // Apply a staged database restore (Settings → Backup & restore) at
      // startup. The config window already exists by setup(), but the sql
      // pool only opens when the webview's JS first calls Database.load —
      // which cannot beat these few statements — so nothing holds camog.db
      // open during the swap. app_config_dir, not app_data_dir:
      // tauri-plugin-sql resolves sqlite: paths against the config dir
      // (identical to the data dir on Windows/macOS, distinct on Linux),
      // and the swap must target the database the plugin actually opens.
      // Applied before anything can open camog.db; the outcome is only
      // recorded once the log target below exists — diagnostics logged
      // before plugin installation never reach the file.
      let restore_outcome = app
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| db_restore::apply_pending_restore(&dir));
      // Logs in every build (release support was blind before): stdout for
      // dev, a rotating file in the OS log dir, webview console.
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .max_file_size(1_000_000)
          .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
              file_name: Some("camog".into()),
            }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
          ])
          .build(),
      )?;
      match restore_outcome {
        Some(Ok(Some(()))) => diagnostics::record(
          diagnostics::Level::Info,
          "db-restore",
          "Database restored from a staged backup; the previous database was kept as camog.pre-restore.db",
          None,
        ),
        Some(Ok(None)) | None => {}
        Some(Err(msg)) => diagnostics::record(diagnostics::Level::Error, "db-restore", &msg, None),
      }
      // The photo key file lives beside the database; point the crypto
      // module at it before any command can need the key.
      if let Ok(dir) = app.path().app_data_dir() {
        photo_crypto::init_key_path(dir.join("photo-key"));
      }
      // The licence device-ID file prefers a machine-wide location and falls
      // back to the home directory (never the app data dir the database sits
      // in — see licence_device.rs).
      if let Ok(dir) = app.path().home_dir() {
        licence_device::init_device_path(dir);
      }
      diagnostics::record(
        diagnostics::Level::Info,
        "app",
        &format!("Camog started (v{}, {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS),
        None,
      );
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    // Opens the hosted buy page (licence purchase) in the system browser.
    .plugin(tauri_plugin_opener::init())
    .plugin(
      SqlBuilder::default()
        .add_migrations("sqlite:camog.db", migrations)
        .build(),
    )
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      grant_directory_access,
      db_restore::restart_for_restore,
      licence_device::device_id,
      licence_device::device_id_fresh,
      licence_device::device_id_adopt,
      licence_activation::activate_licence,
      photo_crypto::photo_encrypt_bytes,
      photo_crypto::photo_decrypt_bytes,
      report::generate_case_report,
      report::print_report,
      report::reveal_saved_report,
      remote_camera::start_remote_camera,
      remote_camera::stop_remote_camera,
      remote_camera::reset_pairing_token,
      remote_camera::remote_camera_active,
      remote_camera::remote_camera_idle_ms,
      remote_camera::get_phone_link_remember,
      remote_camera::set_phone_link_remember,
      remote_camera::update_remote_library,
      remote_camera::clear_remote_library,
      remote_camera::stage_remote_report,
      diagnostics::record_web_diagnostic,
      diagnostics::diagnostics_info,
      diagnostics::diagnostics_clear
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
