// Case report PDF generation (krilla). All layout is hand-measured with the
// bundled Geist fonts via skrifa advances, so wrapping and pagination are
// deterministic across platforms. Fully offline: reads photo JPEGs from the
// local photos directory and writes the PDF to a user-chosen path.

use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point, Rect, Size, Transform};
use krilla::image::Image;
use krilla::metadata::Metadata;
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, Stroke};
use krilla::surface::Surface;
use krilla::text::{Font as KrillaFont, TextDirection};
use krilla::Document;
use serde::Deserialize;

use skrifa::charmap::Charmap;
use skrifa::metrics::GlyphMetrics;
use skrifa::prelude::{FontRef, LocationRef, MetadataProvider, Size as SkrifaSize};

// A4 portrait in PDF points.
const PAGE_W: f32 = 595.276;
const PAGE_H: f32 = 841.89;
const MARGIN_X: f32 = 48.0;
// Photos must end above the footer zone (hairline + text live below this).
const CONTENT_BOTTOM: f32 = PAGE_H - 64.0;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN_X;

// Photo figure geometry: image left, caption column right.
const IMAGE_W: f32 = 240.0;
const IMAGE_H: f32 = 300.0;
const CAPTION_X: f32 = MARGIN_X + IMAGE_W + 22.0;
const CAPTION_W: f32 = PAGE_W - MARGIN_X - CAPTION_X;
const ENTRY_GAP: f32 = 30.0;

// krilla surfaces use a top-left origin; all y values below are top-down.
const FOOTER_RULE_Y: f32 = PAGE_H - 34.0;
const FOOTER_TEXT_Y: f32 = PAGE_H - 22.0;

// Palette: app tokens (zinc neutrals, clinical teal) locked for print.
fn ink() -> rgb::Color {
  rgb::Color::new(0x18, 0x18, 0x1B)
}
fn body_color() -> rgb::Color {
  rgb::Color::new(0x3F, 0x3F, 0x46)
}
fn sub_color() -> rgb::Color {
  rgb::Color::new(0x52, 0x52, 0x5B)
}
fn faint() -> rgb::Color {
  rgb::Color::new(0x71, 0x71, 0x7A)
}
fn hairline_color() -> rgb::Color {
  rgb::Color::new(0xE4, 0xE4, 0xE7)
}
fn teal() -> rgb::Color {
  rgb::Color::new(0x00, 0x7B, 0x82)
}
fn alert_color() -> rgb::Color {
  rgb::Color::new(0xB3, 0x26, 0x1E)
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
  pub save_path: String,
  pub patient_name: String,
  #[serde(default)]
  pub date_of_birth: Option<String>,
  #[serde(default)]
  pub treating_clinician: Option<String>,
  pub prepared_by: String,
  pub prepared_at: String,
  pub consent_label: String,
  pub consent_valid: bool,
  /// "14 photos" or "14 of 22 photos" (already localised by the caller).
  pub photo_count_label: String,
  /// "12/03/2024 to 19/08/2026" (already localised by the caller).
  #[serde(default)]
  pub timeline_label: Option<String>,
  pub photos: Vec<ReportPhoto>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportPhoto {
  /// Absolute path to the on-disk JPEG. The webview already enforced
  /// patient-level access control before offering the report.
  pub path: String,
  /// Pre-formatted dd/MM/yyyy capture date.
  pub captured_label: String,
  pub body_part: String,
  #[serde(default)]
  pub subpart: Option<String>,
  #[serde(default)]
  pub clinical_notes: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportOutcome {
  pub page_count: u32,
}

/// One loaded font face: krilla's draw-side handle plus skrifa metrics for
/// measuring text (krilla 0.8 exposes no public width API).
struct Face {
  font: KrillaFont,
  upem: f32,
  charmap: Charmap<'static>,
  metrics: GlyphMetrics<'static>,
}

impl Face {
  fn load(bytes: &'static [u8]) -> Face {
    let font = KrillaFont::new(bytes.into(), 0).expect("bundled Geist font must parse");
    let font_ref = FontRef::from_index(bytes, 0).expect("bundled Geist font must parse");
    let charmap = font_ref.charmap();
    let metrics = font_ref.glyph_metrics(SkrifaSize::unscaled(), LocationRef::default());
    let upem = font.units_per_em();
    Face {
      font,
      upem,
      charmap,
      metrics,
    }
  }

  /// Advance width of a single-line string at `size`, in points. Unmapped
  /// chars fall back to 0.55em (defensive only; notes are typed Latin text).
  fn width(&self, text: &str, size: f32) -> f32 {
    let scale = size / self.upem;
    let mut units = 0.0f32;
    for ch in text.chars() {
      units += match self.charmap.map(ch) {
        Some(gid) => self.metrics.advance_width(gid).unwrap_or(0.55 * self.upem),
        None => 0.55 * self.upem,
      };
    }
    units * scale
  }

  fn char_width_units(&self, ch: char) -> f32 {
    match self.charmap.map(ch) {
      Some(gid) => self.metrics.advance_width(gid).unwrap_or(0.55 * self.upem),
      None => 0.55 * self.upem,
    }
  }

}

struct Fonts {
  regular: Face,
  medium: Face,
  semibold: Face,
}

impl Fonts {
  /// Brand eyebrow strip style (page headers).
  fn eyebrow(&self) -> LabelStyle<'_> {
    LabelStyle { face: &self.medium, size: 7.5, color: faint(), tracking: 1.4 }
  }
  /// Small uppercase field/figure label style.
  fn micro(&self) -> LabelStyle<'_> {
    LabelStyle { face: &self.medium, size: 7.0, color: faint(), tracking: 1.1 }
  }
}

fn load_fonts() -> Fonts {
  Fonts {
    regular: Face::load(include_bytes!("../assets/fonts/Geist-Regular.ttf")),
    medium: Face::load(include_bytes!("../assets/fonts/Geist-Medium.ttf")),
    semibold: Face::load(include_bytes!("../assets/fonts/Geist-SemiBold.ttf")),
  }
}

/// Greedy word wrap. Paragraphs split on '\n'; over-long words break per
/// character so a pathological note can never overflow the column.
fn wrap_text(text: &str, face: &Face, size: f32, max_w: f32) -> Vec<String> {
  let mut lines = Vec::new();
  for para in text.split('\n') {
    let mut line = String::new();
    for word in para.split(' ').filter(|w| !w.is_empty()) {
      let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
      if face.width(&candidate, size) <= max_w {
        line = candidate;
        continue;
      }
      if !line.is_empty() {
        lines.push(std::mem::take(&mut line));
      }
      // The word alone exceeds the column: hard-break it.
      if face.width(word, size) > max_w {
        let mut chunk = String::new();
        for ch in word.chars() {
          if face.width(&format!("{chunk}{ch}"), size) > max_w && !chunk.is_empty() {
            lines.push(std::mem::take(&mut chunk));
          }
          chunk.push(ch);
        }
        line = chunk;
      } else {
        line = word.to_string();
      }
    }
    lines.push(line);
  }
  if lines.is_empty() {
    lines.push(String::new());
  }
  lines
}

// ---- drawing helpers (top-down coordinates; PDF origin is bottom-left) ----

fn fill(color: rgb::Color) -> Fill {
  Fill {
    paint: color.into(),
    opacity: NormalizedF32::ONE,
    rule: Default::default(),
  }
}

fn text(s: &mut Surface, x: f32, baseline: f32, face: &Face, size: f32, str: &str, color: rgb::Color) {
  s.set_fill(Some(fill(color)));
  s.draw_text(
    Point::from_xy(x, baseline),
    face.font.clone(),
    size,
    str,
    false,
    TextDirection::Auto,
  );
}

fn text_right(
  s: &mut Surface,
  right_x: f32,
  baseline: f32,
  face: &Face,
  size: f32,
  str: &str,
  color: rgb::Color,
) {
  let x = right_x - face.width(str, size);
  text(s, x, baseline, face, size, str, color);
}

/// Letter-spaced micro label (krilla has no tracking API, so advance
/// manually). `tracking` is extra points between characters.
/// Style bundle for a tracked micro label so call sites stay readable.
struct LabelStyle<'a> {
  face: &'a Face,
  size: f32,
  color: rgb::Color,
  tracking: f32,
}

fn tracked(s: &mut Surface, x: f32, baseline: f32, style: &LabelStyle, str: &str) {
  let (face, size, color, tracking) = (style.face, style.size, style.color, style.tracking);
  s.set_fill(Some(fill(color)));
  let mut cx = x;
  for ch in str.chars() {
    let single = ch.to_string();
    s.draw_text(
      Point::from_xy(cx, baseline),
      face.font.clone(),
      size,
      &single,
      false,
      TextDirection::Auto,
    );
    cx += face.char_width_units(ch) * (size / face.upem) + tracking;
  }
}

fn rule(s: &mut Surface, x0: f32, x1: f32, y: f32, color: rgb::Color, width: f32) {
  let mut pb = PathBuilder::new();
  pb.move_to(x0, y);
  pb.line_to(x1, y);
  if let Some(path) = pb.finish() {
    // draw_path paints with fill AND stroke when both are set: clear the
    // fill so a stroked path can never be filled by stale text colour
    // (this bug shipped photo frames as solid grey rectangles).
    s.set_fill(None);
    s.set_stroke(Some(Stroke {
      paint: color.into(),
      width,
      ..Default::default()
    }));
    s.draw_path(&path);
  }
}

fn rect_outline(s: &mut Surface, rect: Rect, color: rgb::Color, width: f32) {
  let mut pb = PathBuilder::new();
  pb.push_rect(rect);
  if let Some(path) = pb.finish() {
    // draw_path paints with fill AND stroke when both are set: clear the
    // fill so a stroked path can never be filled by stale text colour
    // (this bug shipped photo frames as solid grey rectangles).
    s.set_fill(None);
    s.set_stroke(Some(Stroke {
      paint: color.into(),
      width,
      ..Default::default()
    }));
    s.draw_path(&path);
  }
}

// ---- document assembly ----

struct PhotoDraw {
  image: Image,
  photo: ReportPhoto,
}

fn new_page(document: &mut Document) -> krilla::page::Page<'_> {
  let settings = PageSettings::from_wh(PAGE_W, PAGE_H).expect("A4 dimensions are valid");
  document.start_page_with(settings)
}

fn finish_page_footer(s: &mut Surface, fonts: &Fonts, page_no: u32, total: u32) {
  rule(s, MARGIN_X, PAGE_W - MARGIN_X, FOOTER_RULE_Y, hairline_color(), 0.75);
  text(
    s,
    MARGIN_X,
    FOOTER_TEXT_Y,
    &fonts.regular,
    7.5,
    "Camog · Confidential clinical record",
    faint(),
  );
  let page_label = if total > 0 {
    format!("Page {page_no} of {total}")
  } else {
    format!("Page {page_no}")
  };
  text_right(
    s,
    PAGE_W - MARGIN_X,
    FOOTER_TEXT_Y,
    &fonts.regular,
    7.5,
    &page_label,
    faint(),
  );
}

/// Page 1 masthead: brand eyebrow, title, prepared-by block, identity grid,
/// teal rule. Returns the y where photo content may begin.
fn draw_header(s: &mut Surface, req: &ReportRequest, fonts: &Fonts) -> f32 {
  tracked(s, MARGIN_X, 54.0, &fonts.eyebrow(), "CAMOG · CLINICAL PHOTO DOCUMENTATION");
  text(s, MARGIN_X, 86.0, &fonts.semibold, 21.0, "Patient case report", ink());
  text_right(
    s,
    PAGE_W - MARGIN_X,
    72.0,
    &fonts.regular,
    8.5,
    &format!("Prepared by {}", req.prepared_by),
    sub_color(),
  );
  text_right(s, PAGE_W - MARGIN_X, 86.0, &fonts.regular, 8.5, &req.prepared_at, sub_color());

  // Identity grid: three columns, two rows. Cells wrap to two lines max.
  let col_w = CONTENT_W / 3.0;
  let consent_color = if req.consent_valid { body_color() } else { alert_color() };
  let row1: [(&str, String); 3] = [
    ("PATIENT", req.patient_name.clone()),
    (
      "DATE OF BIRTH",
      req.date_of_birth.clone().unwrap_or_else(|| String::from("Not recorded")),
    ),
    ("PHOTOS", req.photo_count_label.clone()),
  ];
  let row2: [(&str, String); 3] = [
    (
      "TREATING CLINICIAN",
      req.treating_clinician.clone().unwrap_or_else(|| String::from("Not recorded")),
    ),
    (
      "PHOTO TIMELINE",
      req.timeline_label.clone().unwrap_or_else(|| String::from("-")),
    ),
    ("PHOTO CONSENT", req.consent_label.clone()),
  ];
  let row2_colors = [ink(), ink(), consent_color];

  let mut y = 118.0f32;
  for (row, colors) in [(row1, [ink(), ink(), ink()]), (row2, row2_colors)] {
    let mut row_extra = 0.0f32;
    let laid: Vec<(&str, Vec<String>)> = row
      .iter()
      .map(|(label, value)| {
        let mut lines = wrap_text(value, &fonts.medium, 10.0, col_w);
        if lines.len() > 2 {
          lines.truncate(2);
          let mut last = lines.pop().unwrap_or_default();
          while fonts.medium.width(&last, 10.0) > col_w - 8.0 && last.len() > 1 {
            last.pop();
          }
          last.push('…');
          lines.push(last);
        }
        if lines.len() > 1 {
          row_extra = row_extra.max((lines.len() - 1) as f32 * 12.0);
        }
        (*label, lines)
      })
      .collect();
    for (ci, (label, lines)) in laid.iter().enumerate() {
      let x = MARGIN_X + ci as f32 * col_w;
      tracked(s, x, y, &fonts.micro(), label);
      let color = colors[ci];
      let mut vy = y + 15.0;
      for line in lines {
        text(s, x, vy, &fonts.medium, 10.0, line, color);
        vy += 12.0;
      }
    }
    y += 15.0 + 12.0 + 6.0 + row_extra + 12.0;
  }

  rule(s, MARGIN_X, PAGE_W - MARGIN_X, y, teal(), 1.5);
  y + 26.0
}


fn draw_continuation_header(s: &mut Surface, req: &ReportRequest, fonts: &Fonts) -> f32 {
  tracked(s, MARGIN_X, 46.0, &fonts.eyebrow(), &upper_limited(&req.patient_name, 48));
  text_right(
    s,
    PAGE_W - MARGIN_X,
    46.0,
    &fonts.regular,
    8.5,
    "Case report continued",
    faint(),
  );
  rule(s, MARGIN_X, PAGE_W - MARGIN_X, 59.0, hairline_color(), 0.75);
  80.0
}

/// Uppercase with an ellipsis cap so a long patient name cannot overflow the
/// continuation header strip.
fn upper_limited(s: &str, max_chars: usize) -> String {
  let mut up = s.to_uppercase();
  if up.chars().count() > max_chars {
    up = up.chars().take(max_chars).collect::<String>() + "…";
  }
  up
}

fn image_display_size(pd: &PhotoDraw) -> (f32, f32) {
  let (w, h) = pd.image.size();
  let (w, h) = (w as f32, h as f32);
  if w <= 0.0 || h <= 0.0 {
    return (IMAGE_W, IMAGE_W);
  }
  let scale = (IMAGE_W / w).min(IMAGE_H / h);
  (w * scale, h * scale)
}

/// Height the caption column needs (mirrors draw_caption's y math).
fn measure_caption(pd: &PhotoDraw, fonts: &Fonts) -> f32 {
  let mut h = 26.0; // date line + photo index line
  h += 18.0; // body site line
  if has_notes(pd) {
    h += 18.0; // notes label line
    let lines = wrap_text(pd.photo.clinical_notes.as_deref().unwrap_or(""), &fonts.regular, 9.0, CAPTION_W);
    h += lines.len() as f32 * 13.0;
  }
  h
}

fn has_notes(pd: &PhotoDraw) -> bool {
  pd.photo
    .clinical_notes
    .as_deref()
    .is_some_and(|n| !n.trim().is_empty())
}

fn entry_height(pd: &PhotoDraw, fonts: &Fonts) -> f32 {
  let (_, dh) = image_display_size(pd);
  dh.max(measure_caption(pd, fonts))
}

/// A photo figure plus its 1-based position in the report.
struct Figure<'a> {
  pd: &'a PhotoDraw,
  index: usize,
  total: usize,
}

fn draw_caption(s: &mut Surface, fig: &Figure, fonts: &Fonts, y_top: f32) -> f32 {
  let pd = fig.pd;
  let mut cy = y_top + 12.0;
  text(s, CAPTION_X, cy, &fonts.semibold, 11.0, &pd.photo.captured_label, ink());
  cy += 17.0;
  let label = format!("PHOTO {} OF {}", fig.index, fig.total);
  tracked(s, CAPTION_X, cy, &fonts.micro(), &label);
  cy += 18.0;
  let site = match &pd.photo.subpart {
    Some(sub) if !sub.is_empty() => format!("{} · {}", pd.photo.body_part, sub),
    _ => pd.photo.body_part.clone(),
  };
  text(s, CAPTION_X, cy, &fonts.medium, 10.0, &site, body_color());
  cy += 18.0;
  if has_notes(pd) {
    tracked(s, CAPTION_X, cy, &fonts.micro(), "NOTES");
    cy += 13.0;
    for line in wrap_text(pd.photo.clinical_notes.as_deref().unwrap_or(""), &fonts.regular, 9.0, CAPTION_W) {
      text(s, CAPTION_X, cy, &fonts.regular, 9.0, &line, body_color());
      cy += 13.0;
    }
  }
  cy
}

fn draw_entry(s: &mut Surface, fig: &Figure, fonts: &Fonts, y_top: f32) -> f32 {
  let pd = fig.pd;
  let (dw, dh) = image_display_size(pd);
  // Images draw under the current transform: translate, draw, restore.
  s.push_transform(&Transform::from_translate(MARGIN_X, y_top));
  s.draw_image(pd.image.clone(), Size::from_wh(dw, dh).expect("positive image size"));
  s.pop();
  // Frame the photo so light clinical shots read against the white page.
  let rect = Rect::from_xywh(MARGIN_X, y_top, dw, dh).expect("positive image size");
  rect_outline(s, rect, hairline_color(), 0.8);

  let caption_bottom = draw_caption(s, fig, fonts, y_top);
  y_top + dh.max(caption_bottom - y_top)
}

/// Render the full document. `total_pages` is 0 on the first pass (footers
/// omit the total); the caller re-renders with the counted total so every
/// footer can say "Page x of y". Layout is a pure function of the inputs, so
/// the page count from pass one is exact.
fn render_report(
  req: &ReportRequest,
  fonts: &Fonts,
  photos: &[PhotoDraw],
  total_pages: u32,
) -> (Vec<u8>, u32) {
  let mut document = Document::new();
  document.set_metadata(
    Metadata::new()
      .title(format!("Patient case report - {}", req.patient_name))
      .creator(String::from("Camog"))
      .authors(vec![req.prepared_by.clone()]),
  );

  let mut pages = 1u32;
  let mut page = new_page(&mut document);
  let mut surface = page.surface();
  let mut y = draw_header(&mut surface, req, fonts);

  let total = photos.len();
  for (i, pd) in photos.iter().enumerate() {
    let fig = Figure { pd, index: i + 1, total };
    let h = entry_height(pd, fonts);
    if y + h > CONTENT_BOTTOM {
      finish_page_footer(&mut surface, fonts, pages, total_pages);
      surface.finish();
      page.finish();
      page = new_page(&mut document);
      surface = page.surface();
      pages += 1;
      y = draw_continuation_header(&mut surface, req, fonts);
    }
    y = draw_entry(&mut surface, &fig, fonts, y) + ENTRY_GAP;
  }

  // Closing note on the last photo page (space permitting, else its own page).
  let closing = format!(
    "This report was generated locally with Camog on {}. All photos and clinical notes remain stored on the treating clinician's device; Camog does not transmit patient data.",
    req.prepared_at
  );
  let closing_lines = wrap_text(&closing, &fonts.regular, 8.5, CONTENT_W);
  let closing_h = 16.0 + 12.0 + closing_lines.len() as f32 * 12.0;
  if y + closing_h > CONTENT_BOTTOM {
    finish_page_footer(&mut surface, fonts, pages, total_pages);
    surface.finish();
    page.finish();
    page = new_page(&mut document);
    surface = page.surface();
    pages += 1;
    y = draw_continuation_header(&mut surface, req, fonts);
  }
  rule(&mut surface, MARGIN_X, PAGE_W - MARGIN_X, y, hairline_color(), 0.75);
  let mut cy = y + 20.0;
  for line in &closing_lines {
    text(&mut surface, MARGIN_X, cy, &fonts.regular, 8.5, line, faint());
    cy += 12.0;
  }

  finish_page_footer(&mut surface, fonts, pages, total_pages);
  surface.finish();
  page.finish();

  let bytes = document.finish().expect("krilla document finish");
  (bytes, pages)
}

// ---- command ----

#[tauri::command]
pub fn generate_case_report(request: ReportRequest) -> Result<ReportOutcome, String> {
  let fonts = load_fonts();

  // Read and validate every photo before writing anything, so a moved file
  // fails up-front instead of producing a half-finished report on disk.
  let mut photos = Vec::with_capacity(request.photos.len());
  for p in &request.photos {
    let bytes = std::fs::read(&p.path).map_err(|_| {
      format!(
        "Could not read the photo captured {}. It may have been moved or deleted. Reopen this patient's timeline and try again.",
        p.captured_label
      )
    })?;
    let image = Image::from_jpeg(bytes.into(), true)
      .map_err(|_| format!("The photo captured {} is not a readable image file.", p.captured_label))?;
    photos.push(PhotoDraw { image, photo: p.clone() });
  }

  // Pass 1 counts pages; pass 2 renders with "Page x of y" footers.
  let (_, pages) = render_report(&request, &fonts, &photos, 0);
  let (bytes, pages2) = render_report(&request, &fonts, &photos, pages);
  debug_assert_eq!(pages, pages2);

  std::fs::write(&request.save_path, &bytes)
    .map_err(|e| format!("Could not write the PDF: {e}. Check that the folder is writable."))?;
  Ok(ReportOutcome { page_count: pages })
}

/// Open the native print dialog for the main window. WKWebView's JS
/// window.print() is a silent no-op, so printing must go through Tauri.
#[tauri::command]
pub fn print_report(app: tauri::AppHandle) -> Result<(), String> {
  use tauri::Manager;
  match app.get_webview_window("main") {
    Some(window) => window.print().map_err(|e| e.to_string()),
    None => Err(String::from("Main window not found")),
  }
}

/// Reveal a saved report in the platform file manager (Finder on macOS).
/// Local-only affordance for the "save, then send it yourself" flow.
#[tauri::command]
pub fn reveal_saved_report(path: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  let result = std::process::Command::new("open")
    .arg("-R")
    .arg(&path)
    .spawn()
    .map(|_| ());

  #[cfg(target_os = "windows")]
  let result = std::process::Command::new("explorer")
    .arg(format!("/select,{path}"))
    .spawn()
    .map(|_| ());

  #[cfg(all(unix, not(target_os = "macos"), not(target_os = "windows")))]
  let result = std::path::Path::new(&path)
    .parent()
    .map(|dir| std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ()))
    .unwrap_or_else(|| std::process::Command::new("xdg-open").arg(&path).spawn().map(|_| ()));

  result.map_err(|e| format!("Could not open the file manager: {e}"))
}

// ---- tests ----

#[cfg(test)]
mod tests {
  use super::*;

  /// Decompress every stream and check the operators we rely on: every photo
  /// is drawn exactly once (Do), and no path is ever filled+stroked (B) —
  /// the "solid grey photo boxes" bug was a stale fill surviving into the
  /// photo frame stroke.
  fn assert_content_operators(pdf: &[u8], expected_images: usize) {
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
      if from >= haystack.len() {
        return None;
      }
      haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
    }

    let mut do_count = 0;
    let mut b_count = 0;
    let mut i = 0;
    while let Some(pos) = find(pdf, b"stream", i) {
      // "endstream" contains "stream"; skip those.
      if pos >= 3 && &pdf[pos - 3..pos] == b"end" {
        i = pos + 6;
        continue;
      }
      let mut start = pos + 6;
      while start < pdf.len() && (pdf[start] == b'\r' || pdf[start] == b'\n') {
        start += 1;
      }
      let end = find(pdf, b"endstream", start).unwrap_or(pdf.len());
      let stream = &pdf[start..end.min(pdf.len())];
      let mut z = ZlibDecoder::new(stream);
      let mut out = Vec::new();
      if z.read_to_end(&mut out).is_ok() {
        let text = String::from_utf8_lossy(&out);
        do_count += text.matches(" Do").count();
        b_count += text.matches("\nB\n").count() + text.matches(" B\n").count() + text.matches(" B ").count();
      }
      i = end.max(pos + 6);
    }
    assert_eq!(do_count, expected_images, "every photo must be drawn exactly once");
    assert_eq!(b_count, 0, "no path may be filled+stroked (stale-fill bug)");
  }

  #[test]
  fn wrap_fits_column_and_preserves_words() {
    let f = load_fonts();
    let text = "Irregular naevus on the left cheek with mild border changes noted at review. Patient reports intermittent itching.";
    let lines = wrap_text(text, &f.regular, 9.0, 120.0);
    assert!(lines.len() >= 2, "should wrap: {lines:?}");
    for line in &lines {
      assert!(
        f.regular.width(line, 9.0) <= 120.0 + 1.0,
        "line overflows: {line:?}"
      );
    }
    let joined = lines.join(" ");
    assert!(joined.contains("Irregular naevus"));
    assert!(joined.contains("itching."));
  }

  #[test]
  fn wrap_breaks_unbroken_overlong_words() {
    let f = load_fonts();
    let lines = wrap_text(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa b",
      &f.regular,
      9.0,
      60.0,
    );
    assert!(lines.len() >= 2);
    assert!(lines.iter().all(|l| f.regular.width(l, 9.0) <= 61.0));
    // Nothing lost.
    assert!(lines.join("").contains("aaaa") && lines.join("").ends_with('b'));
  }

  #[test]
  fn renders_multipage_pdf_with_stable_pagination() {
    let sample = include_bytes!("../testdata/sample.jpg");
    let photo_meta: Vec<ReportPhoto> = (0..7)
      .map(|i| ReportPhoto {
        path: format!("/tmp/photo-{i}.jpg"),
        captured_label: format!("0{i}/03/2024"),
        body_part: String::from("Face"),
        subpart: Some(String::from("Cheek")),
        clinical_notes: Some(String::from(
          "Review photo. Border appears stable compared with the previous capture; no ulceration.",
        )),
      })
      .collect();
    let photos: Vec<PhotoDraw> = photo_meta
      .iter()
      .map(|p| PhotoDraw {
        image: Image::from_jpeg(sample.to_vec().into(), true).unwrap(),
        photo: p.clone(),
      })
      .collect();

    let req = ReportRequest {
      save_path: String::new(),
      patient_name: String::from("Amina Fouad"),
      date_of_birth: Some(String::from("14/02/1981")),
      treating_clinician: Some(String::from("Dr Sarah Whitlam")),
      prepared_by: String::from("Dr Sarah Whitlam"),
      prepared_at: String::from("25/08/2026, 2:05 pm"),
      consent_label: String::from("Clinical care (expires 12/05/2027)"),
      consent_valid: true,
      photo_count_label: String::from("7 photos"),
      timeline_label: Some(String::from("01/03/2024 to 07/03/2024")),
      photos: photo_meta,
    };

    let fonts = load_fonts();
    let (bytes, pages) = render_report(&req, &fonts, &photos, 0);
    assert!(pages >= 3, "7 photos at ~330pt each need >= 3 pages, got {pages}");
    assert!(bytes.starts_with(b"%PDF"), "output is a PDF");

    // Pass 2 with the known total must not change pagination.
    let (bytes2, pages2) = render_report(&req, &fonts, &photos, pages);
    assert_eq!(pages, pages2);
    assert!(bytes2.starts_with(b"%PDF"));
    assert!(bytes2.len() > 10_000, "embedded JPEGs should give a substantial file");

    // Design-iteration affordance: CAMOG_REPORT_DUMP=/tmp/dir cargo test dumps
    // the rendered PDF for visual review.
    if let Ok(dir) = std::env::var("CAMOG_REPORT_DUMP") {
      let _ = std::fs::write(format!("{dir}/report-test.pdf"), &bytes2);
    }
    assert_content_operators(&bytes2, photos.len());
  }
}
