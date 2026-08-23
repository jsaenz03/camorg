// Camog Tauri shell. Storage is delegated to tauri-plugin-sql (SQLite) and
// tauri-plugin-fs (photo files). App-level Rust commands: photo-directory
// scope grants and the phone-camera tether server.

mod remote_camera;

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
  ];

  // Grants the fs plugin runtime access to a user-chosen photo directory
  // (e.g. a cloud-synced folder outside the app data dir). Capability scopes
  // are static, so a persisted custom dir must be re-granted on every launch.
  #[tauri::command]
  fn grant_directory_access(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
      .allow_directory(&path, true)
      .map_err(|e| e.to_string())
  }

  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
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
      remote_camera::start_remote_camera,
      remote_camera::stop_remote_camera
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
