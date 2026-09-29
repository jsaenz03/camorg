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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, Wry};
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};
use tauri_plugin_fs::FsExt;

/// Tray + window-close behaviour, shared between the Rust shell and the
/// webview. The stored setting lives in the settings table (web-owned);
/// the webview pushes it here on every settings load/change. The window
/// close handler must answer synchronously, so it reads this cached flag
/// rather than the database.
struct TrayPrefs {
  close_to_tray: AtomicBool,
  /// Filled once the tray exists in setup(): the summary menu line and the
  /// tray handle that `update_tray_summary` keeps fresh.
  summary_item: Mutex<Option<MenuItem<Wry>>>,
  tray: Mutex<Option<TrayIcon<Wry>>>,
}

/// Un-hide, un-minimise and focus the main window. The tray icon click, the
/// tray "Open Camog" item and the single-instance callback all land here.
fn show_main_window(app: &tauri::AppHandle) {
  if let Some(webview) = app.get_webview_window("main") {
    let _ = webview.show();
    let _ = webview.unminimize();
    let _ = webview.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = app_migrations();

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

  /// Web-owned preference: hide to the tray on window close (default on).
  #[tauri::command]
  fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    app
      .state::<TrayPrefs>()
      .close_to_tray
      .store(enabled, Ordering::Relaxed);
    Ok(())
  }

  /// Push the pre-formatted alert summary ("2 reviews overdue · 1 consent
  /// expired") into the tray menu line + tooltip, and swap the tray icon to
  /// the badge-dot variant while anything needs attention. Formatting stays
  /// in the webview so the copy lives in one place; Rust is a dumb pipe. An
  /// empty summary means "all clear".
  #[tauri::command]
  fn update_tray_summary(app: tauri::AppHandle, summary: String) -> Result<(), String> {
    let prefs = app.state::<TrayPrefs>();
    if let Some(item) = prefs.summary_item.lock().ok().and_then(|g| g.clone()) {
      let _ = item.set_text(if summary.is_empty() {
        String::from("Up to date")
      } else {
        summary.clone()
      });
    }
    if let Some(tray) = prefs.tray.lock().ok().and_then(|g| g.clone()) {
      let _ = tray.set_tooltip(if summary.is_empty() {
        Some(String::from("Camog"))
      } else {
        Some(format!("Camog — {summary}"))
      });
      // 32x32-alert.png is the plain logo + a #dc2626 badge dot (bottom
      // right); regenerate it alongside 32x32.png when the logo changes.
      let icon = if summary.is_empty() {
        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
      } else {
        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32-alert.png"))
      };
      if let Ok(icon) = icon {
        let _ = tray.set_icon(Some(icon));
      }
    }
    Ok(())
  }

  tauri::Builder::default()
    // Second launch focuses the existing window instead of opening a second
    // process on the same SQLite file (split-brain UI + SQLITE_BUSY writes).
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      // Covers the hidden-to-tray case too: a second launch must surface
      // the window, not just focus a hidden webview.
      show_main_window(app);
    }))
    // Post-mortem breadcrumb: when the Windows WebView2 renderer dies the
    // window just turns white (no crash event reaches Rust), so camog.log
    // records each completed navigation — the last line before a white
    // screen is the page that died. Path only; never the query string
    // (it can carry a patient id).
    .on_page_load(|_webview, payload| {
      if let tauri::webview::PageLoadEvent::Finished = payload.event() {
        diagnostics::record(
          diagnostics::Level::Info,
          "webview",
          &format!("page loaded: {}", payload.url().path()),
          None,
        );
      }
    })
    .setup(|app| {
      diagnostics::install_panic_hook();
      // Close-to-tray cache; the tray handles are filled in below once the
      // tray icon exists.
      app.manage(TrayPrefs {
        close_to_tray: AtomicBool::new(true),
        summary_item: Mutex::new(None),
        tray: Mutex::new(None),
      });
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
      // System tray: a disabled summary line the webview keeps fresh (alert
      // counters), Open and Quit. A left click opens the window on both
      // platforms; the menu (Open Camog, Quit) is right-click only.
      let summary_item = MenuItem::with_id(app, "tray-summary", "Up to date", false, None::<&str>)?;
      let open_item = MenuItem::with_id(app, "tray-open", "Open Camog", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "tray-quit", "Quit Camog", true, None::<&str>)?;
      let tray_menu = Menu::with_items(
        app,
        &[
          &summary_item,
          &PredefinedMenuItem::separator(app)?,
          &open_item,
          &quit_item,
        ],
      )?;
      let tray = TrayIconBuilder::with_id("camog-tray")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
        .tooltip("Camog")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "tray-open" => show_main_window(app),
          "tray-quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main_window(tray.app_handle());
          }
        })
        .build(app)?;
      let prefs = app.state::<TrayPrefs>();
      *prefs.summary_item.lock().expect("tray summary item lock") = Some(summary_item);
      *prefs.tray.lock().expect("tray handle lock") = Some(tray);
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    // Opens the hosted buy page (licence purchase) in the system browser.
    .plugin(tauri_plugin_opener::init())
    // Local OS notifications for review/consent alerts (generic text only).
    .plugin(tauri_plugin_notification::init())
    .plugin(
      SqlBuilder::default()
        .add_migrations("sqlite:camog.db", migrations)
        .build(),
    )
    .plugin(tauri_plugin_fs::init())
    // Close-to-tray: the window close button hides Camog while the tray
    // keeps running (alert counters stay live). Turned off via Settings →
    // App settings; Quit in the tray menu always exits for real.
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          let prefs = window.app_handle().state::<TrayPrefs>();
          if prefs.close_to_tray.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
          }
        }
      } else if let tauri::WindowEvent::Destroyed = event {
        // Crash-vs-quiet-quit breadcrumb: a destroyed window followed by a
        // later "Camog started" marks an unexpected exit in camog.log.
        diagnostics::record(
          diagnostics::Level::Info,
          "window",
          &format!("window {} destroyed", window.label()),
          None,
        );
      }
    })
    .invoke_handler(tauri::generate_handler![
      grant_directory_access,
      set_close_to_tray,
      update_tray_summary,
      db_restore::restart_for_restore,
      licence_device::device_id,
      licence_device::device_id_fresh,
      licence_device::device_id_adopt,
      licence_activation::activate_licence,
      licence_activation::validate_licence,
      photo_crypto::photo_encrypt_bytes,
      photo_crypto::photo_decrypt_bytes,
      report::generate_case_report,
      report::print_report,
      report::reveal_saved_report,
      report::email_case_report,
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


/// The app's SQLite migrations, registered with tauri-plugin-sql in run().
/// Extracted from run() so a test can pin the numbering (see migration_tests
/// below). ponytail: inline here. If the count grows, move to a migrations/ dir.
fn app_migrations() -> Vec<Migration> {
  vec![
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
  Migration {
    version: 22,
    description: "licence: last definitive seat re-validation timestamp",
    sql: include_str!("../migrations/022_licence_validated.sql"),
    kind: MigrationKind::Up,
  },
  Migration {
    version: 23,
    description: "licence: auto-renew toggle (specs/005), default on",
    sql: include_str!("../migrations/023_licence_auto_renew.sql"),
    kind: MigrationKind::Up,
  },
  Migration {
    version: 24,
    description: "note templates: per-clinician quick-text phrases + shortcuts",
    sql: include_str!("../migrations/024_note_templates.sql"),
    kind: MigrationKind::Up,
  },
  Migration {
    version: 25,
    description: "note templates: replace v1 starters (dupe-prone seeds, overlapping content)",
    sql: include_str!("../migrations/025_note_template_starters_v2.sql"),
    kind: MigrationKind::Up,
  },
  Migration {
    version: 26,
    description: "settings: close-to-tray toggle (system tray with alert counters)",
    sql: include_str!("../migrations/026_close_to_tray.sql"),
    kind: MigrationKind::Up,
  },
  Migration {
    version: 27,
    description: "patients: optional email (prefills report email drafts)",
    sql: include_str!("../migrations/027_patient_email.sql"),
    kind: MigrationKind::Up,
  },
    Migration {
      version: 28,
      description: "scaling: global listing indexes",
      sql: include_str!("../migrations/028_scaling_indexes.sql"),
      kind: MigrationKind::Up,
    },
  ]
}

#[cfg(test)]
mod migration_tests {
  use super::*;

  /// A migration file that exists but isn't registered in app_migrations()
  /// silently never runs — the same class of miss as the three-file version
  /// bump in the releases convention. Versions must be contiguous from 1 and
  /// match the numbered files in src-tauri/migrations exactly.
  #[test]
  fn migration_versions_are_contiguous_and_match_files() {
    let migrations = app_migrations();
    let versions: Vec<i64> = migrations.iter().map(|m| m.version).collect();
    let expected: Vec<i64> = (1..=versions.len() as i64).collect();
    assert_eq!(versions, expected, "migration versions must be contiguous from 1");

    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut files: Vec<i64> = std::fs::read_dir(&dir)
      .expect("migrations dir exists")
      .flatten()
      .filter_map(|e| {
        let name = e.file_name().into_string().ok()?;
        if !name.ends_with(".sql") {
          return None;
        }
        name.split('_').next()?.parse().ok()
      })
      .collect();
    files.sort_unstable();
    files.dedup();
    assert_eq!(
      files, versions,
      "every migration file must be registered in app_migrations(), and every registration must have a file"
    );
  }
}

// The badge-dot variant must decode to the same dimensions as the plain logo
// and actually differ from it — a missing or placeholder asset would silently
// no-op the tray attention indicator.
#[cfg(test)]
mod tray_icon_tests {
  use tauri::image::Image;

  #[test]
  fn alert_tray_icon_decodes_and_differs_from_plain() {
    let plain = Image::from_bytes(include_bytes!("../icons/32x32.png")).expect("plain icon decodes");
    let alert =
      Image::from_bytes(include_bytes!("../icons/32x32-alert.png")).expect("alert icon decodes");
    assert_eq!((plain.width(), plain.height()), (32, 32));
    assert_eq!((alert.width(), alert.height()), (32, 32));
    assert_ne!(plain.rgba(), alert.rgba(), "alert icon carries no visible badge");
  }
}
