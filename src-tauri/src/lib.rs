// Camog Tauri shell. Storage is delegated to tauri-plugin-sql (SQLite) and
// tauri-plugin-fs (photo files). No app-level Rust commands.

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

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
  ];

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
    .plugin(
      SqlBuilder::default()
        .add_migrations("sqlite:camog.db", migrations)
        .build(),
    )
    .plugin(tauri_plugin_fs::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
