//! Build provenance (silent).
//!
//! A quiet ownership mark compiled into the binary and stamped into the
//! artifacts the app produces: every generated PDF's document info
//! (report.rs), the bundle metadata (tauri.conf.json `bundle.copyright`),
//! and the exported HTML head (app/layout.tsx). Nothing renders it in the
//! UI; the audit path is scripts/self-check-provenance.mjs, which checks
//! the sources and `strings`-scans any built binary for the marker.

/// The provenance marker. Pure ASCII so a `strings` scan of any built
/// binary finds it verbatim.
pub const PROVENANCE: &str = "com.camog.app - Copyright (C) 2026 Camog. All rights reserved.";
