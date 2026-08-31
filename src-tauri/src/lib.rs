// Camog Tauri shell. Storage is delegated to tauri-plugin-sql (SQLite) and
// tauri-plugin-fs (photo files). App-level Rust commands: photo-directory
// scope grants and the phone-camera tether server.

mod diagnostics;
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
      diagnostics::record(
        diagnostics::Level::Info,
        "app",
        &format!("Camog started (v{}, {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS),
        None,
      );
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .plugin(
      SqlBuilder::default()
        .add_migrations("sqlite:camog.db", migrations)
        .build(),
    )
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      grant_directory_access,
      report::generate_case_report,
      report::print_report,
      report::reveal_saved_report,
      remote_camera::start_remote_camera,
      remote_camera::stop_remote_camera,
      remote_camera::remote_camera_active,
      remote_camera::remote_camera_idle_ms,
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
