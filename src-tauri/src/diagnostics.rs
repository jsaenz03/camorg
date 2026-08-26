// In-session diagnostics: a capped ring buffer of notable events (command
// failures, panics, webview errors) shown in Settings → Diagnostics. Every
// entry is also written through the `log` crate, so it lands in the rotating
// camog.log file and survives a restart. Entries must never contain patient
// names — keep messages generic (counts, paths only with care).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// ponytail: in-memory session buffer (lost on quit); the log file is the
/// durable history. Upgrade path: persist entries to a table in camog.db.
const CAP: usize = 500;

const MAX_SOURCE: usize = 120;
const MAX_MESSAGE: usize = 2_000;
const MAX_DETAIL: usize = 8_000;

#[derive(Debug, Clone, Copy)]
pub enum Level {
  Error,
  Info,
}

impl Level {
  fn as_str(self) -> &'static str {
    match self {
      Level::Error => "error",
      Level::Info => "info",
    }
  }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
  /// Epoch milliseconds.
  pub ts: u64,
  /// "error" | "warn" | "info".
  pub level: &'static str,
  /// Where it came from, e.g. "report", "panic", "webview:ui".
  pub source: String,
  pub message: String,
  pub detail: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInfo {
  pub version: &'static str,
  pub os: &'static str,
  /// Folder holding the persistent camog.log (null if unresolvable).
  pub log_dir: Option<String>,
  /// Oldest first; the UI reverses for display.
  pub entries: Vec<DiagnosticEntry>,
}

static ENTRIES: Mutex<VecDeque<DiagnosticEntry>> = Mutex::new(VecDeque::new());

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

fn log_line(level: &str, source: &str, message: &str) {
  match level {
    "error" => log::error!("[{source}] {message}"),
    "warn" => log::warn!("[{source}] {message}"),
    _ => log::info!("[{source}] {message}"),
  }
}

fn push(entry: DiagnosticEntry) {
  if let Ok(mut entries) = ENTRIES.lock() {
    if entries.len() >= CAP {
      entries.pop_front();
    }
    entries.push_back(entry);
  }
}

/// Record a Rust-side event: ring buffer + log file.
pub fn record(level: Level, source: &str, message: &str, detail: Option<String>) {
  log_line(level.as_str(), source, message);
  push(DiagnosticEntry {
    ts: now_ms(),
    level: level.as_str(),
    source: source.into(),
    message: message.into(),
    detail,
  });
}

/// Forward panics into the diagnostics buffer before the default hook runs.
pub fn install_panic_hook() {
  let previous = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    record(Level::Error, "panic", &info.to_string(), None);
    previous(info);
  }));
}

/// Sanitise webview-supplied input (trust boundary: strings from the JS
/// side). Level coerces to a known value; fields truncate at char
/// boundaries so one pathological message can't evict the whole buffer.
fn web_entry(level: &str, source: &str, message: &str, detail: Option<&str>) -> DiagnosticEntry {
  let level = match level {
    "error" => "error",
    "warn" => "warn",
    _ => "info",
  };
  let truncate = |s: &str, max: usize| s.chars().take(max).collect::<String>();
  DiagnosticEntry {
    ts: now_ms(),
    level,
    source: truncate(source, MAX_SOURCE),
    message: truncate(message, MAX_MESSAGE),
    detail: detail.map(|d| truncate(d, MAX_DETAIL)),
  }
}

/// Frontend capture entry point (uncaught JS errors, unhandled rejections,
/// console/toast wrappers in lib/diagnostics.ts).
#[tauri::command]
pub fn record_web_diagnostic(level: String, source: String, message: String, detail: Option<String>) {
  let entry = web_entry(&level, &source, &message, detail.as_deref());
  // Also mirrored to the log file via log_line; the log plugin's Webview
  // target only prints back into the console if the JS side attaches a
  // listener (we never do), so this cannot echo into the buffer twice.
  log_line(entry.level, &entry.source, &entry.message);
  push(entry);
}

#[tauri::command]
pub fn diagnostics_info(app: tauri::AppHandle) -> DiagnosticsInfo {
  use tauri::Manager;
  DiagnosticsInfo {
    version: env!("CARGO_PKG_VERSION"),
    os: std::env::consts::OS,
    log_dir: app.path().app_log_dir().ok().map(|p| p.to_string_lossy().into_owned()),
    entries: ENTRIES.lock().map(|q| q.iter().cloned().collect()).unwrap_or_default(),
  }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDiagnosticsOutcome {
  /// Truncated or deleted log files (active + rotated).
  pub log_files_cleared: u32,
  /// Set when a file could not be cleared (e.g. locked by another process);
  /// the UI reports it instead of claiming a full wipe.
  pub log_error: Option<String>,
}

/// A Camog log file in the log dir: the active `camog.log`, rotated
/// `camog_<date>.log` files, and their rare `.bak` collision variants.
/// The prefix tests keep unrelated files (e.g. `camography.log`) out.
fn is_camog_log(name: &str) -> bool {
  (name.starts_with("camog.") || name.starts_with("camog_"))
    && (name.ends_with(".log") || name.ends_with(".log.bak"))
}

fn clear_buffer() {
  if let Ok(mut entries) = ENTRIES.lock() {
    entries.clear();
  }
}

/// Clear everything: the session buffer and every log file on disk. The
/// active `camog.log` is held open by the log plugin in append mode, so it
/// is truncated (never unlinked — on Unix an unlink would leave the logger
/// writing into a deleted inode until the next rotation).
#[tauri::command]
pub fn diagnostics_clear(app: tauri::AppHandle) -> ClearDiagnosticsOutcome {
  use tauri::Manager;
  clear_buffer();

  let mut outcome = ClearDiagnosticsOutcome { log_files_cleared: 0, log_error: None };
  if let Ok(dir) = app.path().app_log_dir() {
    if let Ok(files) = std::fs::read_dir(&dir) {
      for path in files.flatten().map(|e| e.path()) {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !is_camog_log(&name) {
          continue;
        }
        let result = if name == "camog.log" {
          std::fs::File::create(&path).map(|_| ())
        } else {
          std::fs::remove_file(&path)
        };
        match result {
          Ok(()) => outcome.log_files_cleared += 1,
          Err(e) => outcome.log_error = Some(format!("{name}: {e}")),
        }
      }
    }
  }

  // Anchor line: lands in the emptied buffer and the recreated log file so a
  // wipe is visible after the fact.
  record(Level::Info, "app", "Diagnostics cleared by user", None);
  outcome
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn ring_buffer_caps_at_limit() {
    clear_buffer();
    for i in 0..(CAP + 100) {
      push(web_entry("error", "test", &format!("message {i}"), None));
    }
    let entries = ENTRIES.lock().unwrap();
    assert_eq!(entries.len(), CAP, "buffer must cap at {CAP}");
    assert_eq!(
      entries.front().unwrap().message,
      format!("message {}", 100),
      "oldest 100 entries evicted"
    );
    assert_eq!(entries.back().unwrap().message, format!("message {}", CAP + 99));
  }

  #[test]
  fn web_input_is_coerced_and_truncated() {
    let e = web_entry(
      "catastrophic",
      &"s".repeat(MAX_SOURCE + 50),
      &"m".repeat(MAX_MESSAGE + 50),
      Some(&"😀".repeat(MAX_DETAIL + 50)),
    );
    assert_eq!(e.level, "info", "unknown level coerces to info");
    assert!(e.source.chars().count() <= MAX_SOURCE);
    assert!(e.message.chars().count() <= MAX_MESSAGE);
    assert!(
      e.detail.unwrap().chars().count() <= MAX_DETAIL,
      "truncation must respect char boundaries (multibyte input)"
    );
  }

  #[test]
  fn camog_log_files_are_matched_exactly() {
    for name in ["camog.log", "camog_2026-08-26.log", "camog_2026-08-26.log.bak"] {
      assert!(is_camog_log(name), "{name} must be wiped");
    }
    for name in ["camography.log", "other.log", "camog"] {
      assert!(!is_camog_log(name), "{name} must be left alone");
    }
  }
}
