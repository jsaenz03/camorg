// Case report PDF generation (krilla). All layout is hand-measured with the
// bundled Geist fonts via skrifa advances, so wrapping and pagination are
// deterministic across platforms. Fully offline: reads photo JPEGs from the
// local photos directory and writes the PDF to a user-chosen path.

use krilla::color::rgb;
use krilla::geom::{Path, PathBuilder, Point, Rect, Size, Transform};
use krilla::image::Image;
use krilla::metadata::Metadata;
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, Stroke};
use krilla::surface::Surface;
use krilla::text::{Font as KrillaFont, TextDirection};
use krilla::Document;
use serde::Deserialize;
use std::sync::Mutex;

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
  /// Raw body-part enum key ("hand") so the PDF can draw the matching
  /// body-map highlight. Absent on callers predating the diagram.
  #[serde(default)]
  pub body_part_key: Option<String>,
  /// Patient's own side for paired regions.
  #[serde(default)]
  pub laterality: Option<String>,
  /// Pinpoint X (normalized 0..1) plus which diagram it belongs to: "body"
  /// (the whole-map print silhouette) or "part" (the zoomed detail diagram,
  /// where the X actually means something at lesion scale).
  #[serde(default)]
  pub pin_x: Option<f32>,
  #[serde(default)]
  pub pin_y: Option<f32>,
  /// "body" | "part"; absent means the pin is only half-specified and is dropped.
  #[serde(default)]
  pub pin_space: Option<String>,
  /// Which face of hands/feet the X was marked on ("front" | "back"); read
  /// as "front" when absent.
  #[serde(default)]
  pub pin_view: Option<String>,
  #[serde(default)]
  pub subpart: Option<String>,
  #[serde(default)]
  pub clinical_notes: Option<String>,
  /// Lesion series name; photos sharing one arrive as a contiguous block
  /// (ordered by the caller) and open with a "Linked series" heading. Absent
  /// on unlinked photos and callers predating series grouping.
  #[serde(default)]
  pub series_label: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportOutcome {
  pub page_count: u32,
  /// How an email draft left the device, so the webview can say what the
  /// clinician still has to do: None for Save PDF and the macOS .eml path
  /// (attachment embedded); "mapi" — compose window with the PDF attached;
  /// "eml" — Windows with no MAPI client: the .eml draft (HTML body +
  /// embedded PDF) opened in the machine's .eml handler, Send or Forward
  /// from there; "mailto" — compose window without the attachment (no MAPI
  /// client and no .eml handler; the PDF was saved to Downloads for manual
  /// attach); "saved-only" — no mail app at all (PDF saved to Downloads +
  /// revealed).
  #[serde(skip_serializing_if = "Option::is_none")]
  pub handoff: Option<String>,
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
  // Text paints with fill AND stroke when a stroke is left set (krilla's
  // combined-paint rule): clear the stroke so path drawing (e.g. the red
  // pinpoint X) can never bleed into following text.
  s.set_stroke(None);
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
  s.set_stroke(None);
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

// ---- body map diagram ----

// The print body map draws the same 200x320 silhouette as the app badge,
// scaled into the caption column. Geometry mirrors FRONT/BACK in
// body-map-picker.tsx (paint order matters: face and scalp sit over the head).
const BODY_MAP_H: f32 = 76.0;
const BODY_MAP_W: f32 = BODY_MAP_H * 200.0 / 320.0;
// Gap between the body map and the zoomed part detail diagram beside it.
const DETAIL_GAP: f32 = 14.0;

enum MapShape {
  Rect { x: f32, y: f32, w: f32, h: f32, r: f32 },
  Ellipse { cx: f32, cy: f32, rx: f32, ry: f32 },
}

struct MapRegion {
  part: &'static str,
  shape: MapShape,
}

const NECK_MAP: MapRegion = MapRegion {
  part: "neck",
  shape: MapShape::Rect { x: 90.0, y: 74.0, w: 20.0, h: 14.0, r: 5.0 },
};

const FRONT_MAP: &[MapRegion] = &[
  MapRegion { part: "head", shape: MapShape::Ellipse { cx: 100.0, cy: 46.0, rx: 26.0, ry: 32.0 } },
  MapRegion { part: "chest", shape: MapShape::Rect { x: 76.0, y: 84.0, w: 48.0, h: 38.0, r: 10.0 } },
  MapRegion { part: "abdomen", shape: MapShape::Rect { x: 78.0, y: 124.0, w: 44.0, h: 44.0, r: 10.0 } },
  MapRegion { part: "upper_arm", shape: MapShape::Rect { x: 48.0, y: 88.0, w: 20.0, h: 46.0, r: 10.0 } },
  MapRegion { part: "upper_arm", shape: MapShape::Rect { x: 132.0, y: 88.0, w: 20.0, h: 46.0, r: 10.0 } },
  MapRegion { part: "forearm", shape: MapShape::Rect { x: 46.0, y: 138.0, w: 18.0, h: 44.0, r: 9.0 } },
  MapRegion { part: "forearm", shape: MapShape::Rect { x: 136.0, y: 138.0, w: 18.0, h: 44.0, r: 9.0 } },
  MapRegion { part: "hand", shape: MapShape::Ellipse { cx: 55.0, cy: 194.0, rx: 11.0, ry: 13.0 } },
  MapRegion { part: "hand", shape: MapShape::Ellipse { cx: 145.0, cy: 194.0, rx: 11.0, ry: 13.0 } },
  MapRegion { part: "thigh", shape: MapShape::Rect { x: 78.0, y: 172.0, w: 20.0, h: 56.0, r: 10.0 } },
  MapRegion { part: "thigh", shape: MapShape::Rect { x: 102.0, y: 172.0, w: 20.0, h: 56.0, r: 10.0 } },
  MapRegion { part: "leg", shape: MapShape::Rect { x: 78.0, y: 232.0, w: 18.0, h: 52.0, r: 9.0 } },
  MapRegion { part: "leg", shape: MapShape::Rect { x: 104.0, y: 232.0, w: 18.0, h: 52.0, r: 9.0 } },
  MapRegion { part: "foot", shape: MapShape::Ellipse { cx: 84.0, cy: 296.0, rx: 11.0, ry: 9.0 } },
  MapRegion { part: "foot", shape: MapShape::Ellipse { cx: 116.0, cy: 296.0, rx: 11.0, ry: 9.0 } },
  MapRegion { part: "face", shape: MapShape::Ellipse { cx: 100.0, cy: 54.0, rx: 17.0, ry: 21.0 } },
  MapRegion { part: "scalp", shape: MapShape::Rect { x: 82.0, y: 14.0, w: 36.0, h: 12.0, r: 6.0 } },
];

const BACK_MAP: &[MapRegion] = &[
  MapRegion { part: "head", shape: MapShape::Ellipse { cx: 100.0, cy: 46.0, rx: 26.0, ry: 32.0 } },
  MapRegion { part: "back", shape: MapShape::Rect { x: 76.0, y: 84.0, w: 48.0, h: 84.0, r: 10.0 } },
  MapRegion { part: "upper_arm", shape: MapShape::Rect { x: 48.0, y: 88.0, w: 20.0, h: 46.0, r: 10.0 } },
  MapRegion { part: "upper_arm", shape: MapShape::Rect { x: 132.0, y: 88.0, w: 20.0, h: 46.0, r: 10.0 } },
  MapRegion { part: "forearm", shape: MapShape::Rect { x: 46.0, y: 138.0, w: 18.0, h: 44.0, r: 9.0 } },
  MapRegion { part: "forearm", shape: MapShape::Rect { x: 136.0, y: 138.0, w: 18.0, h: 44.0, r: 9.0 } },
  MapRegion { part: "hand", shape: MapShape::Ellipse { cx: 55.0, cy: 194.0, rx: 11.0, ry: 13.0 } },
  MapRegion { part: "hand", shape: MapShape::Ellipse { cx: 145.0, cy: 194.0, rx: 11.0, ry: 13.0 } },
  MapRegion { part: "thigh", shape: MapShape::Rect { x: 78.0, y: 172.0, w: 20.0, h: 56.0, r: 10.0 } },
  MapRegion { part: "thigh", shape: MapShape::Rect { x: 102.0, y: 172.0, w: 20.0, h: 56.0, r: 10.0 } },
  MapRegion { part: "leg", shape: MapShape::Rect { x: 78.0, y: 232.0, w: 18.0, h: 52.0, r: 9.0 } },
  MapRegion { part: "leg", shape: MapShape::Rect { x: 104.0, y: 232.0, w: 18.0, h: 52.0, r: 9.0 } },
  MapRegion { part: "foot", shape: MapShape::Ellipse { cx: 84.0, cy: 296.0, rx: 11.0, ry: 9.0 } },
  MapRegion { part: "foot", shape: MapShape::Ellipse { cx: 116.0, cy: 296.0, rx: 11.0, ry: 9.0 } },
  MapRegion { part: "scalp", shape: MapShape::Ellipse { cx: 100.0, cy: 40.0, rx: 18.0, ry: 16.0 } },
];

/// Rounded-rect outline in local coordinates (kappa-approximated corners).
fn push_rounded_rect(pb: &mut PathBuilder, x: f32, y: f32, w: f32, h: f32, r: f32) {
  let kappa = 0.552_284_7;
  let (rx, ry) = (r.min(w / 2.0), r.min(h / 2.0));
  let (hx, hy) = (kappa * rx, kappa * ry);
  let (x1, y1) = (x + w, y + h);
  pb.move_to(x + rx, y);
  pb.line_to(x1 - rx, y);
  pb.cubic_to(x1 - rx + hx, y, x1, y + ry - hy, x1, y + ry);
  pb.line_to(x1, y1 - ry);
  pb.cubic_to(x1, y1 - ry + hy, x1 - rx + hx, y1, x1 - rx, y1);
  pb.line_to(x + rx, y1);
  pb.cubic_to(x + rx - hx, y1, x, y1 - ry + hy, x, y1 - ry);
  pb.line_to(x, y + ry);
  pb.cubic_to(x, y + ry - hy, x + rx - hx, y, x + rx, y);
  pb.close();
}

/// Ellipse outline in local coordinates (kappa-approximated).
fn push_ellipse(pb: &mut PathBuilder, cx: f32, cy: f32, rx: f32, ry: f32) {
  let kappa = 0.552_284_7;
  pb.move_to(cx + rx, cy);
  pb.cubic_to(cx + rx, cy + kappa * ry, cx + kappa * rx, cy + ry, cx, cy + ry);
  pb.cubic_to(cx - kappa * rx, cy + ry, cx - rx, cy + kappa * ry, cx - rx, cy);
  pb.cubic_to(cx - rx, cy - kappa * ry, cx - kappa * rx, cy - ry, cx, cy - ry);
  pb.cubic_to(cx + kappa * rx, cy - ry, cx + rx, cy - kappa * ry, cx + rx, cy);
  pb.close();
}

/// One cubic-corner rounded/straight outline, already scaled into page points.
fn map_shape_path(shape: &MapShape, dx: f32, dy: f32, k: f32) -> Option<Path> {
  let mut pb = PathBuilder::new();
  match *shape {
    MapShape::Rect { x, y, w, h, r } => {
      push_rounded_rect(&mut pb, dx + x * k, dy + y * k, w * k, h * k, r * k);
    }
    MapShape::Ellipse { cx, cy, rx, ry } => {
      push_ellipse(&mut pb, dx + cx * k, dy + cy * k, rx * k, ry * k);
    }
  }
  pb.finish()
}

/// Does this silhouette region carry the highlight for the photo's site?
/// The front view mirrors (patient's right limb is on the viewer's left).
fn region_matches(
  region: &MapRegion,
  body_part: &str,
  laterality: Option<&str>,
  view: &str,
) -> bool {
  if region.part != body_part {
    return false;
  }
  let bilateral = matches!(
    body_part,
    "upper_arm" | "forearm" | "hand" | "thigh" | "leg" | "foot"
  );
  if !bilateral || laterality.is_none() {
    return true;
  }
  let mid_x = match region.shape {
    MapShape::Rect { x, w, .. } => x + w / 2.0,
    MapShape::Ellipse { cx, .. } => cx,
  };
  let screen_left = mid_x < 100.0;
  let patient_left = if view == "front" { !screen_left } else { screen_left };
  patient_left == (laterality == Some("left"))
}

fn draw_body_map(
  s: &mut Surface,
  dx: f32,
  dy: f32,
  body_part: &str,
  laterality: Option<&str>,
  pin: Option<(f32, f32)>,
) {
  let view = if matches!(body_part, "back" | "scalp") { "back" } else { "front" };
  let regions: &[MapRegion] = if view == "back" { BACK_MAP } else { FRONT_MAP };
  let k = BODY_MAP_H / 320.0;

  let draw_region = |s: &mut Surface, region: &MapRegion, hit: bool| {
    let Some(path) = map_shape_path(&region.shape, dx, dy, k) else {
      return;
    };
    // Fill and stroke in separate draws: setting both makes krilla emit the
    // combined "B" operator, which the content guard bans (stale-fill bug).
    s.set_fill(Some(fill(if hit { teal() } else { hairline_color() })));
    s.set_stroke(None);
    s.draw_path(&path);
    s.set_fill(None);
    s.set_stroke(Some(Stroke {
      paint: sub_color().into(),
      width: 0.5,
      ..Default::default()
    }));
    s.draw_path(&path);
  };

  draw_region(s, &NECK_MAP, region_matches(&NECK_MAP, body_part, laterality, view));
  for region in regions {
    let hit = region_matches(region, body_part, laterality, view);
    draw_region(s, region, hit);
  }

  // The pinpoint X, only for whole-map marks (bigger than the app badge's
  // relative X so it stays legible at print size).
  if let Some((px, py)) = pin {
    draw_pin_x(s, dx + px * 200.0 * k, dy + py * 320.0 * k, k);
  }
}

/// The print X marker (alert red, oversized relative to the app badge so it
/// stays legible on paper), centred on the given page point.
fn draw_pin_x(s: &mut Surface, gx: f32, gy: f32, k: f32) {
  let span = 14.0 * k;
  let mut pb = PathBuilder::new();
  pb.move_to(gx - span, gy - span);
  pb.line_to(gx + span, gy + span);
  pb.move_to(gx - span, gy + span);
  pb.line_to(gx + span, gy - span);
  if let Some(path) = pb.finish() {
    s.set_fill(None);
    s.set_stroke(Some(Stroke {
      paint: alert_color().into(),
      width: 2.2,
      ..Default::default()
    }));
    s.draw_path(&path);
  }
}

// ---- part detail diagram ----

// The zoomed per-part diagram from the edit-photo modal (its second chip),
// transcribed 1:1 from DETAIL_DIAGRAMS in part-detail-diagram.tsx. Same
// 200x320 space as the body map so pinpoints read identically; every drawing
// shows the patient's LEFT side and is mirrored for the right. Filled shapes
// are the silhouette, Hint* the lighter anatomy guides.
enum DetailShape {
  FillRect { x: f32, y: f32, w: f32, h: f32, r: f32 },
  FillEllipse { cx: f32, cy: f32, rx: f32, ry: f32 },
  /// Ellipse rotated `deg` degrees about its centre (hand thumbs).
  FillEllipseRot { cx: f32, cy: f32, rx: f32, ry: f32, deg: f32 },
  HintEllipse { cx: f32, cy: f32, rx: f32, ry: f32 },
  HintLine { x1: f32, y1: f32, x2: f32, y2: f32 },
  /// Quadratic curve: M(x0,y0) Q(cx,cy) (x1,y1).
  HintQuad { x0: f32, y0: f32, cx: f32, cy: f32, x1: f32, y1: f32 },
}

const DETAIL_HEAD: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 150.0, rx: 68.0, ry: 92.0 },
  DetailShape::FillRect { x: 82.0, y: 232.0, w: 36.0, h: 52.0, r: 12.0 },
];

const DETAIL_FACE: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 160.0, rx: 64.0, ry: 88.0 },
  DetailShape::HintEllipse { cx: 74.0, cy: 132.0, rx: 8.0, ry: 8.0 },
  DetailShape::HintEllipse { cx: 126.0, cy: 132.0, rx: 8.0, ry: 8.0 },
  DetailShape::HintLine { x1: 100.0, y1: 148.0, x2: 100.0, y2: 180.0 },
  DetailShape::HintLine { x1: 74.0, y1: 208.0, x2: 126.0, y2: 208.0 },
];

const DETAIL_SCALP: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 170.0, rx: 74.0, ry: 102.0 },
  DetailShape::HintQuad { x0: 36.0, y0: 130.0, cx: 100.0, cy: 62.0, x1: 164.0, y1: 130.0 },
  DetailShape::HintQuad { x0: 52.0, y0: 100.0, cx: 100.0, cy: 48.0, x1: 148.0, y1: 100.0 },
];

const DETAIL_NECK: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 66.0, rx: 56.0, ry: 46.0 },
  DetailShape::FillRect { x: 62.0, y: 98.0, w: 76.0, h: 186.0, r: 30.0 },
];

const DETAIL_CHEST: &[DetailShape] = &[
  DetailShape::FillRect { x: 40.0, y: 58.0, w: 120.0, h: 192.0, r: 24.0 },
  DetailShape::HintLine { x1: 54.0, y1: 88.0, x2: 94.0, y2: 100.0 },
  DetailShape::HintLine { x1: 146.0, y1: 88.0, x2: 106.0, y2: 100.0 },
  DetailShape::HintLine { x1: 100.0, y1: 100.0, x2: 100.0, y2: 180.0 },
];

const DETAIL_ABDOMEN: &[DetailShape] = &[
  DetailShape::FillRect { x: 45.0, y: 48.0, w: 110.0, h: 222.0, r: 24.0 },
  DetailShape::HintLine { x1: 100.0, y1: 108.0, x2: 100.0, y2: 252.0 },
  DetailShape::HintLine { x1: 45.0, y1: 180.0, x2: 155.0, y2: 180.0 },
];

const DETAIL_BACK: &[DetailShape] = &[
  DetailShape::FillRect { x: 40.0, y: 55.0, w: 120.0, h: 210.0, r: 24.0 },
  DetailShape::HintLine { x1: 100.0, y1: 80.0, x2: 100.0, y2: 246.0 },
  DetailShape::HintEllipse { cx: 66.0, cy: 128.0, rx: 18.0, ry: 28.0 },
  DetailShape::HintEllipse { cx: 134.0, cy: 128.0, rx: 18.0, ry: 28.0 },
];

const DETAIL_UPPER_ARM: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 52.0, rx: 46.0, ry: 34.0 },
  DetailShape::FillRect { x: 68.0, y: 70.0, w: 64.0, h: 200.0, r: 30.0 },
  DetailShape::HintLine { x1: 80.0, y1: 252.0, x2: 120.0, y2: 252.0 },
];

const DETAIL_FOREARM: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 44.0, rx: 38.0, ry: 26.0 },
  DetailShape::FillRect { x: 72.0, y: 60.0, w: 56.0, h: 202.0, r: 26.0 },
  DetailShape::HintLine { x1: 82.0, y1: 242.0, x2: 82.0, y2: 260.0 },
  DetailShape::HintLine { x1: 118.0, y1: 242.0, x2: 118.0, y2: 260.0 },
];

const DETAIL_HAND_BACK: &[DetailShape] = &[
  DetailShape::FillRect { x: 61.0, y: 78.0, w: 17.0, h: 72.0, r: 8.0 },
  DetailShape::FillRect { x: 82.0, y: 66.0, w: 17.0, h: 84.0, r: 8.0 },
  DetailShape::FillRect { x: 103.0, y: 60.0, w: 17.0, h: 90.0, r: 8.0 },
  DetailShape::FillRect { x: 124.0, y: 72.0, w: 17.0, h: 78.0, r: 8.0 },
  DetailShape::FillRect { x: 60.0, y: 142.0, w: 82.0, h: 100.0, r: 22.0 },
  DetailShape::FillEllipseRot { cx: 156.0, cy: 190.0, rx: 16.0, ry: 30.0, deg: 30.0 },
  DetailShape::FillRect { x: 76.0, y: 236.0, w: 50.0, h: 48.0, r: 16.0 },
  DetailShape::HintEllipse { cx: 69.5, cy: 87.0, rx: 4.5, ry: 6.0 },
  DetailShape::HintEllipse { cx: 90.5, cy: 75.0, rx: 4.5, ry: 6.0 },
  DetailShape::HintEllipse { cx: 111.5, cy: 69.0, rx: 4.5, ry: 6.0 },
  DetailShape::HintEllipse { cx: 132.5, cy: 81.0, rx: 4.5, ry: 6.0 },
];

const DETAIL_HAND_PALM: &[DetailShape] = &[
  DetailShape::FillRect { x: 61.0, y: 72.0, w: 17.0, h: 78.0, r: 8.0 },
  DetailShape::FillRect { x: 82.0, y: 60.0, w: 17.0, h: 90.0, r: 8.0 },
  DetailShape::FillRect { x: 103.0, y: 66.0, w: 17.0, h: 84.0, r: 8.0 },
  DetailShape::FillRect { x: 124.0, y: 78.0, w: 17.0, h: 72.0, r: 8.0 },
  DetailShape::FillRect { x: 60.0, y: 142.0, w: 82.0, h: 100.0, r: 22.0 },
  DetailShape::FillEllipseRot { cx: 44.0, cy: 190.0, rx: 16.0, ry: 30.0, deg: -30.0 },
  DetailShape::FillRect { x: 76.0, y: 236.0, w: 50.0, h: 48.0, r: 16.0 },
  DetailShape::HintQuad { x0: 132.0, y0: 176.0, cx: 100.0, cy: 192.0, x1: 68.0, y1: 176.0 },
  DetailShape::HintQuad { x0: 130.0, y0: 208.0, cx: 98.0, cy: 224.0, x1: 70.0, y1: 206.0 },
  DetailShape::HintQuad { x0: 64.0, y0: 182.0, cx: 68.0, cy: 226.0, x1: 96.0, y1: 242.0 },
];

const DETAIL_THIGH: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 44.0, rx: 48.0, ry: 34.0 },
  DetailShape::FillRect { x: 64.0, y: 64.0, w: 72.0, h: 216.0, r: 32.0 },
  DetailShape::HintLine { x1: 80.0, y1: 266.0, x2: 120.0, y2: 266.0 },
];

const DETAIL_LEG: &[DetailShape] = &[
  DetailShape::FillEllipse { cx: 100.0, cy: 40.0, rx: 36.0, ry: 26.0 },
  DetailShape::FillRect { x: 72.0, y: 56.0, w: 56.0, h: 204.0, r: 26.0 },
  DetailShape::HintLine { x1: 82.0, y1: 244.0, x2: 82.0, y2: 260.0 },
  DetailShape::HintLine { x1: 118.0, y1: 244.0, x2: 118.0, y2: 262.0 },
];

const DETAIL_FOOT_SOLE: &[DetailShape] = &[
  DetailShape::FillRect { x: 59.0, y: 84.0, w: 82.0, h: 204.0, r: 28.0 },
  DetailShape::HintEllipse { cx: 68.0, cy: 83.0, rx: 10.5, ry: 10.5 },
  DetailShape::HintEllipse { cx: 83.0, cy: 78.0, rx: 8.5, ry: 8.5 },
  DetailShape::HintEllipse { cx: 101.0, cy: 77.0, rx: 9.0, ry: 9.0 },
  DetailShape::HintEllipse { cx: 119.0, cy: 78.0, rx: 8.5, ry: 8.5 },
  DetailShape::HintEllipse { cx: 134.0, cy: 87.0, rx: 8.0, ry: 8.0 },
];

const DETAIL_FOOT_TOP: &[DetailShape] = &[
  DetailShape::FillRect { x: 59.0, y: 84.0, w: 82.0, h: 204.0, r: 28.0 },
  DetailShape::FillEllipse { cx: 66.0, cy: 87.0, rx: 8.0, ry: 8.0 },
  DetailShape::FillEllipse { cx: 81.0, cy: 78.0, rx: 8.5, ry: 8.5 },
  DetailShape::FillEllipse { cx: 99.0, cy: 77.0, rx: 9.0, ry: 9.0 },
  DetailShape::FillEllipse { cx: 117.0, cy: 78.0, rx: 8.5, ry: 8.5 },
  DetailShape::FillEllipse { cx: 132.0, cy: 83.0, rx: 10.5, ry: 10.5 },
  DetailShape::HintEllipse { cx: 66.0, cy: 82.0, rx: 2.8, ry: 2.8 },
  DetailShape::HintEllipse { cx: 81.0, cy: 72.5, rx: 3.0, ry: 3.0 },
  DetailShape::HintEllipse { cx: 99.0, cy: 71.0, rx: 3.2, ry: 3.2 },
  DetailShape::HintEllipse { cx: 117.0, cy: 72.5, rx: 3.0, ry: 3.0 },
  DetailShape::HintEllipse { cx: 132.0, cy: 75.5, rx: 3.6, ry: 3.6 },
];

/// Shapes for one part; `view` picks the face for hands (palm/back of hand)
/// and feet (top/sole). Empty for parts without a detail diagram (torso).
fn detail_shapes(part: &str, view: &str) -> &'static [DetailShape] {
  match (part, view) {
    ("head", _) => DETAIL_HEAD,
    ("face", _) => DETAIL_FACE,
    ("scalp", _) => DETAIL_SCALP,
    ("neck", _) => DETAIL_NECK,
    ("chest", _) => DETAIL_CHEST,
    ("abdomen", _) => DETAIL_ABDOMEN,
    ("back", _) => DETAIL_BACK,
    ("upper_arm", _) => DETAIL_UPPER_ARM,
    ("forearm", _) => DETAIL_FOREARM,
    ("hand", "back") => DETAIL_HAND_BACK,
    ("hand", _) => DETAIL_HAND_PALM,
    ("thigh", _) => DETAIL_THIGH,
    ("leg", _) => DETAIL_LEG,
    ("foot", "back") => DETAIL_FOOT_SOLE,
    ("foot", _) => DETAIL_FOOT_TOP,
    _ => &[],
  }
}

fn detail_shape_path(shape: &DetailShape) -> Option<Path> {
  let mut pb = PathBuilder::new();
  let rotated = match *shape {
    DetailShape::FillRect { x, y, w, h, r } => {
      push_rounded_rect(&mut pb, x, y, w, h, r);
      None
    }
    DetailShape::FillEllipse { cx, cy, rx, ry } => {
      push_ellipse(&mut pb, cx, cy, rx, ry);
      None
    }
    // Thumbs are ellipses spun about their centre: build at the origin,
    // rotate, then move into place (SVG rotate(deg cx cy)).
    DetailShape::FillEllipseRot { cx, cy, rx, ry, deg } => {
      push_ellipse(&mut pb, 0.0, 0.0, rx, ry);
      Some((deg, cx, cy))
    }
    DetailShape::HintEllipse { cx, cy, rx, ry } => {
      push_ellipse(&mut pb, cx, cy, rx, ry);
      None
    }
    DetailShape::HintLine { x1, y1, x2, y2 } => {
      pb.move_to(x1, y1);
      pb.line_to(x2, y2);
      None
    }
    DetailShape::HintQuad { x0, y0, cx, cy, x1, y1 } => {
      pb.move_to(x0, y0);
      pb.quad_to(cx, cy, x1, y1);
      None
    }
  };
  let mut path = pb.finish()?;
  if let Some((deg, cx, cy)) = rotated {
    path = path.transform(Transform::from_rotate(deg))?;
    path = path.transform(Transform::from_translate(cx, cy))?;
  }
  Some(path)
}

/// The zoomed part diagram beside the body map, at the same print size. The
/// X lands here (not on the small map) when the pin is part-space. The
/// patient's RIGHT mirrors the drawing inside the 200-wide diagram space
/// before it scales onto the page.
fn draw_part_detail(
  s: &mut Surface,
  dx: f32,
  dy: f32,
  part: &str,
  laterality: Option<&str>,
  view: &str,
  pin: Option<(f32, f32)>,
) {
  let shapes = detail_shapes(part, view);
  if shapes.is_empty() {
    return;
  }
  let k = BODY_MAP_H / 320.0;
  let page = if laterality == Some("right") {
    Transform::from_row(-k, 0.0, 0.0, k, dx + 200.0 * k, dy)
  } else {
    Transform::from_row(k, 0.0, 0.0, k, dx, dy)
  };

  for shape in shapes {
    let Some(path) = detail_shape_path(shape) else { continue };
    let Some(path) = path.transform(page) else { continue };
    match shape {
      // Silhouette: fill + outline in separate draws (combined fill+stroke
      // trips the content guard, as in draw_body_map).
      DetailShape::FillRect { .. }
      | DetailShape::FillEllipse { .. }
      | DetailShape::FillEllipseRot { .. } => {
        s.set_fill(Some(fill(hairline_color())));
        s.set_stroke(None);
        s.draw_path(&path);
        s.set_fill(None);
        s.set_stroke(Some(Stroke {
          paint: sub_color().into(),
          width: 0.5,
          ..Default::default()
        }));
        s.draw_path(&path);
      }
      DetailShape::HintEllipse { .. } | DetailShape::HintLine { .. } | DetailShape::HintQuad { .. } => {
        s.set_fill(None);
        s.set_stroke(Some(Stroke {
          paint: faint().into(),
          width: 0.5,
          ..Default::default()
        }));
        s.draw_path(&path);
      }
    }
  }

  if let Some((px, py)) = pin {
    let gx = match laterality {
      Some("right") => dx + (1.0 - px) * 200.0 * k,
      _ => dx + px * 200.0 * k,
    };
    draw_pin_x(s, gx, dy + py * 320.0 * k, k);
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
  if pd.photo.body_part_key.is_some() {
    h += 13.0 + BODY_MAP_H + 6.0; // body map label + diagram + gap
  }
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
  if let Some(key) = pd.photo.body_part_key.as_deref() {
    tracked(s, CAPTION_X, cy, &fonts.micro(), "BODY MAP");
    cy += 13.0;
    let pin = match (pd.photo.pin_x, pd.photo.pin_y, pd.photo.pin_space.as_deref()) {
      (Some(x), Some(y), Some(space)) => Some((x, y, space)),
      _ => None,
    };
    let laterality = pd.photo.laterality.as_deref();
    draw_body_map(
      s,
      CAPTION_X,
      cy,
      key,
      laterality,
      match pin {
        Some((x, y, "body")) => Some((x, y)),
        _ => None,
      },
    );
    // The zoomed part diagram beside it, X included — the modal's second
    // chip. A detail-space X means nothing on the small map, so it only
    // lands here (draw_part_detail skips parts without a diagram).
    if let Some((x, y)) = match pin {
      Some((x, y, "part")) => Some((x, y)),
      _ => None,
    } {
      let view = pd.photo.pin_view.as_deref().unwrap_or("front");
      draw_part_detail(s, CAPTION_X + BODY_MAP_W + DETAIL_GAP, cy, key, laterality, view, Some((x, y)));
    }
    cy += BODY_MAP_H + 6.0;
  }
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

/// How many photos of the report belong to `name` — the member count shown on
/// the heading, so a patient can check they have seen every photo of a lesion.
fn series_member_count(photos: &[PhotoDraw], name: &str) -> usize {
  photos
    .iter()
    .filter(|p| p.photo.series_label.as_deref() == Some(name))
    .count()
}

/// The heading's text lines: the clinician's series name plus the member count.
fn series_heading_lines(name: &str, count: usize, fonts: &Fonts) -> Vec<String> {
  let count_label = if count == 1 { String::from("1 photo") } else { format!("{count} photos") };
  wrap_text(&format!("{name} ({count_label})"), &fonts.medium, 10.0, CONTENT_W)
}

/// Height a series heading occupies, mirroring draw_series_heading's math.
fn series_heading_height(name: &str, count: usize, fonts: &Fonts) -> f32 {
  25.0 + series_heading_lines(name, count, fonts).len() as f32 * 12.0
}

/// Opens a series block: tracked micro label, then the series name with its
/// member count. Drawn once where the block starts; the block's photos follow
/// contiguously (the caller's ordering keeps them together).
fn draw_series_heading(s: &mut Surface, y_top: f32, name: &str, count: usize, fonts: &Fonts) -> f32 {
  tracked(s, MARGIN_X, y_top + 8.0, &fonts.micro(), "LINKED SERIES");
  let mut cy = y_top + 21.0;
  for line in series_heading_lines(name, count, fonts) {
    text(s, MARGIN_X, cy, &fonts.medium, 10.0, &line, ink());
    cy += 12.0;
  }
  series_heading_height(name, count, fonts)
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
      // Silent provenance: the document-info Creator field (PDF properties,
      // never the document itself) carries the ownership mark, so every
      // report leaving the device stays attributable (provenance.rs).
      .creator(format!("Camog | {}", crate::provenance::PROVENANCE))
      .authors(vec![req.prepared_by.clone()]),
  );

  let mut pages = 1u32;
  let mut page = new_page(&mut document);
  let mut surface = page.surface();
  let mut y = draw_header(&mut surface, req, fonts);

  let total = photos.len();
  let mut prev_series: Option<&str> = None;
  for (i, pd) in photos.iter().enumerate() {
    let fig = Figure { pd, index: i + 1, total };
    let series = pd.photo.series_label.as_deref();
    let opens_series = series.is_some() && series != prev_series;
    // A series heading counts toward the entry's height and moves to the next
    // page with its first photo — never stranded at a page bottom.
    let heading_h = match (opens_series, series) {
      (true, Some(name)) => series_heading_height(name, series_member_count(photos, name), fonts),
      _ => 0.0,
    };
    let h = heading_h + entry_height(pd, fonts);
    if y + h > CONTENT_BOTTOM {
      finish_page_footer(&mut surface, fonts, pages, total_pages);
      surface.finish();
      page.finish();
      page = new_page(&mut document);
      surface = page.surface();
      pages += 1;
      y = draw_continuation_header(&mut surface, req, fonts);
    }
    if let (true, Some(name)) = (opens_series, series) {
      y += draw_series_heading(&mut surface, y, name, series_member_count(photos, name), fonts);
    }
    prev_series = series;
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

/// Serialises report rendering across all callers. Before generate_case_report
/// went async, sync commands ran on the (serialising) main thread; async moved
/// renders onto the pool, where two could overlap — and the phone-link report
/// writes to a fixed path (phone-report.pdf), so interleaved writes must not
/// happen. One clinician, one device: queueing beats cleverness.
static GENERATE_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn generate_case_report(request: ReportRequest) -> Result<ReportOutcome, String> {
  let photo_count = request.photos.len();
  // Rendering up to 50 photos takes seconds, and sync commands run on the
  // main thread — a sync generator freezes the whole app while it works
  // (on Windows the window ghosts white / "not responding"). Same shape as
  // email_case_report: keep the main thread free.
  let result = tauri::async_runtime::spawn_blocking(move || generate_case_report_inner(request))
    .await
    .map_err(|e| format!("Report task failed: {e}"))?;
  // Recorded for Settings → Diagnostics; messages must stay patient-free
  // (counts and pages only).
  match result {
    Ok(outcome) => {
      crate::diagnostics::record(
        crate::diagnostics::Level::Info,
        "report",
        &format!("Case report generated ({} photos, {} pages)", photo_count, outcome.page_count),
        None,
      );
      Ok(outcome)
    }
    Err(e) => {
      crate::diagnostics::record(crate::diagnostics::Level::Error, "report", &e, None);
      Err(e)
    }
  }
}

fn generate_case_report_inner(request: ReportRequest) -> Result<ReportOutcome, String> {
  // Poison can only follow a panic mid-render; the lock state is still fine.
  let _serialize = GENERATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let fonts = load_fonts();

  // Read and validate every photo before writing anything, so a moved file
  // fails up-front instead of producing a half-finished report on disk.
  let mut photos = Vec::with_capacity(request.photos.len());
  for p in &request.photos {
    let raw = std::fs::read(&p.path).map_err(|_| {
      format!(
        "Could not read the photo captured {}. It may have been moved or deleted. Reopen this patient's timeline and try again.",
        p.captured_label
      )
    })?;
    // Photo files are AES-GCM encrypted at rest; legacy plaintext passes
    // through unchanged (photo_crypto::decrypt_or_plain).
    let bytes = crate::photo_crypto::decrypt_or_plain(&raw)
      .map_err(|e| format!("The photo captured {} could not be decrypted: {e}", p.captured_label))?;
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
  Ok(ReportOutcome { page_count: pages, handoff: None })
}

/// Open the native print dialog for the main window. WKWebView's JS
/// window.print() is a silent no-op, so printing must go through Tauri.
#[tauri::command]
pub fn print_report(app: tauri::AppHandle) -> Result<(), String> {
  use tauri::Manager;
  let result = match app.get_webview_window("main") {
    Some(window) => window.print().map_err(|e| e.to_string()),
    None => Err(String::from("Main window not found")),
  };
  if let Err(e) = &result {
    crate::diagnostics::record(crate::diagnostics::Level::Error, "print", e, None);
  }
  result
}

/// Reveal a saved report in the platform file manager (Finder on macOS).
/// Local-only affordance for the "save, then send it yourself" flow.
#[tauri::command]
pub fn reveal_saved_report(path: String) -> Result<(), String> {
  reveal_in_file_manager(&path)
}

/// Shared body of the reveal command: used by Save PDF's "show file" toast
/// action and the mailto fallback (where the clinician must attach the PDF
/// themselves, so the file manager should open on it).
fn reveal_in_file_manager(path: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  let result = std::process::Command::new("open")
    .arg("-R")
    .arg(path)
    .spawn()
    .map(|_| ());

  #[cfg(target_os = "windows")]
  let result = std::process::Command::new("explorer")
    .arg(format!("/select,{path}"))
    .spawn()
    .map(|_| ());

  #[cfg(all(unix, not(target_os = "macos"), not(target_os = "windows")))]
  let result = std::path::Path::new(path)
    .parent()
    .map(|dir| std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ()))
    .unwrap_or_else(|| std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ()));

  result.map_err(|e| {
    let msg = format!("Could not open the file manager: {e}");
    crate::diagnostics::record(crate::diagnostics::Level::Error, "reveal", &msg, None);
    msg
  })
}

// ---- email draft handoff ----
//
// A local-only handoff, not a sending feature: the PDF is rendered exactly
// as for "Save PDF", then handed to the clinician's own mail client as a
// draft — MAPISendMailW, or a temporary .eml opened in the mail client
// (macOS always; Windows when no MAPI client is registered). Camog opens no
// network connection for this; nothing is sent until the user presses Send
// in their own client (same posture as printing the report, and the webview
// writes the matching audit entry).

/// Subject line for the draft (both platforms).
fn draft_subject(patient_name: &str) -> String {
  format!("Clinical photo report — {patient_name}")
}

/// Plain-text body. Windows MAPI bodies cannot be HTML; the attached PDF is
/// the formatted artefact (the macOS .eml path gets an HTML variant below).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // test-covered; used by the Windows MAPI handoff
fn draft_body_text(req: &ReportRequest) -> String {
  let mut body = format!(
    "A clinical photo report for {} is attached as a PDF.\n\nPrepared by: {}\nPrepared: {}\nPhotos: {}",
    req.patient_name, req.prepared_by, req.prepared_at, req.photo_count_label
  );
  if let Some(timeline) = &req.timeline_label {
    body.push_str(&format!("\nTimeline: {timeline}"));
  }
  body.push_str(&format!("\nConsent on record: {}", req.consent_label));
  body
}

/// Escape text interpolated into the HTML body (patient/clinician names are
/// free text from the webview).
#[cfg(target_os = "macos")]
fn html_escape(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
}

/// Trust boundary: the recipient arrives over IPC from the webview (the
/// stored patient email). Strip every whitespace character so a stray
/// newline can't split MIME headers or smuggle extra recipients.
fn sanitise_recipient(recipient: &str) -> String {
  recipient.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Clinician-authored draft from the compose dialog: a custom subject and a
/// full HTML body. Both arrive over IPC from the webview; the subject is
/// header-sanitised below, and the HTML is used only as mail-body content
/// handed to the clinician's own client (never parsed or rendered by Camog).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomDraft {
  pub subject: String,
  pub body_html: String,
}

/// Trust boundary: the custom subject lands in MIME headers downstream
/// (RFC 822 for the .eml, and MAPI clients treat it as one), so CR/LF/NUL
/// must never survive into it. Trimmed so an all-whitespace subject falls
/// back to the default via the caller's emptiness check.
fn sanitise_subject(subject: &str) -> String {
  subject
    .chars()
    .filter(|c| !matches!(c, '\r' | '\n' | '\0'))
    .collect::<String>()
    .trim()
    .to_string()
}

/// Naive HTML-to-plain-text for the Windows handoffs (Simple MAPI and
/// mailto: bodies cannot be HTML): <br> and block-closing tags become line
/// breaks, every other tag is dropped, and the handful of entities the
/// compose dialog's template emits are decoded. ponytail: a hand-rolled
/// pass that covers clinician-written HTML, not arbitrary input; upgrade
/// path is a real HTML-to-text crate if artefacts show up in drafts.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // test-covered; used by the Windows handoffs
fn html_to_text(html: &str) -> String {
  let mut text = String::with_capacity(html.len());
  let mut tag = String::new();
  let mut in_tag = false;
  for c in html.chars() {
    match c {
      '<' => {
        in_tag = true;
        tag.clear();
      }
      '>' if in_tag => {
        in_tag = false;
        // <br>, <br/>, <br /> all normalise to "br" before the line-break
        // check; attribute-laden tags (<li style="…">) keep their prefix.
        let name = tag.trim().trim_end_matches('/').trim().to_ascii_lowercase();
        let breaks_line = name == "br"
          || name.starts_with("/p")
          || name.starts_with("/li")
          || name.starts_with("/ul")
          || name.starts_with("/ol")
          || name.starts_with("/div")
          || name.starts_with("/h")
          || name.starts_with("/tr")
          || name.starts_with("/blockquote");
        if breaks_line {
          text.push('\n');
        }
      }
      _ if in_tag => tag.push(c),
      _ => text.push(c),
    }
  }
  // &amp; decodes last so "&amp;lt;" survives as the literal text "&lt;".
  let decoded = text
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&nbsp;", "\u{a0}")
    .replace("&amp;", "&");
  // Hand-written HTML carries indentation between tags; trim each line and
  // collapse blank runs so the plain-text body reads as typed prose.
  let mut lines: Vec<&str> = Vec::new();
  for line in decoded.lines() {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      // Collapse blank runs to one separator line.
      if lines.last().is_some_and(|l| !l.is_empty()) {
        lines.push("");
      }
    } else {
      lines.push(trimmed);
    }
  }
  while lines.last() == Some(&"") {
    lines.pop();
  }
  lines.join("\n")
}

/// Attachment file name derived from the patient name, with the same
/// character set blanked as the webview's sanitiseFileToken.
fn draft_attachment_name(patient_name: &str) -> String {
  let cleaned: String = patient_name
    .chars()
    .map(|c| {
      if matches!(c, '/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>') {
        ' '
      } else {
        c
      }
    })
    .collect();
  format!(
    "Camog case report - {}.pdf",
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
  )
}

/// Build the RFC-822 draft handed to Mail.app on macOS and to the machine's
/// .eml handler on Windows (the no-MAPI fallback): an inline-styled HTML
/// body plus the PDF as a base64 attachment. The subject is RFC 2047
/// encoded so non-ASCII patient names survive; X-Unsent marks the message
/// as a draft for Outlook-family clients. `recipient` is already sanitised.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn build_eml(
  subject: &str,
  recipient: Option<&str>,
  html_body: &str,
  attachment_name: &str,
  pdf: &[u8],
) -> String {
  use base64::engine::general_purpose::STANDARD;
  use base64::Engine;
  const BOUNDARY: &str = "camog-draft-boundary-2b7f41";

  let mut eml = String::new();
  if let Some(to) = recipient {
    eml.push_str(&format!("To: {to}\n"));
  }
  eml.push_str(&format!(
    "Subject: =?utf-8?B?{}?=\n",
    STANDARD.encode(subject.as_bytes())
  ));
  eml.push_str("MIME-Version: 1.0\n");
  eml.push_str("X-Unsent: 1\n");
  eml.push_str(&format!(
    "Content-Type: multipart/mixed; boundary=\"{BOUNDARY}\"\n\n"
  ));

  eml.push_str(&format!("--{BOUNDARY}\n"));
  eml.push_str("Content-Type: text/html; charset=\"utf-8\"\n");
  eml.push_str("Content-Transfer-Encoding: 8bit\n\n");
  eml.push_str(html_body);
  eml.push_str("\n\n");

  eml.push_str(&format!("--{BOUNDARY}\n"));
  eml.push_str(&format!(
    "Content-Type: application/pdf; name=\"{attachment_name}\"\n"
  ));
  eml.push_str("Content-Transfer-Encoding: base64\n");
  eml.push_str(&format!(
    "Content-Disposition: attachment; filename=\"{attachment_name}\"\n\n"
  ));
  let encoded = STANDARD.encode(pdf);
  for chunk in encoded.as_bytes().chunks(76) {
    eml.push_str(std::str::from_utf8(chunk).expect("base64 is ascii"));
    eml.push('\n');
  }
  eml.push_str(&format!("--{BOUNDARY}--\n"));
  eml
}

/// HTML variant of the body (the .eml paths — Mail and Windows .eml
/// handlers render it inline).
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn draft_body_html(req: &ReportRequest) -> String {
  let timeline = req
    .timeline_label
    .as_deref()
    .map(|t| format!("<li>Timeline: {}</li>", html_escape(t)))
    .unwrap_or_default();
  format!(
    "<html><body style=\"font-family: -apple-system, 'Segoe UI', sans-serif; color: #18181b; font-size: 14px; line-height: 1.5;\">\n\
     <p>A clinical photo report for <strong>{}</strong> is attached as a PDF.</p>\n\
     <ul style=\"padding-left: 1.2em;\">\n\
     <li>Prepared by: {}</li>\n\
     <li>Prepared: {}</li>\n\
     <li>Photos: {}</li>\n\
     {}\n\
     <li>Consent on record: {}</li>\n\
     </ul>\n\
     <p style=\"color: #71717a; font-size: 12px;\">Generated locally with Camog. The attached PDF contains the clinical photos and notes.</p>\n\
     </body></html>",
    html_escape(&req.patient_name),
    html_escape(&req.prepared_by),
    html_escape(&req.prepared_at),
    html_escape(&req.photo_count_label),
    timeline,
    html_escape(&req.consent_label),
  )
}

/// The composed HTML verbatim when present, else the stock draft body —
/// shared by the macOS .eml path and the Windows no-MAPI .eml fallback.
/// (An empty/whitespace composition reads as "back to the standard
/// wording", matching the subject handling in email_case_report_inner.)
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn eml_html_body(custom: Option<&CustomDraft>, request: &ReportRequest) -> String {
  custom
    .map(|c| c.body_html.trim())
    .filter(|b| !b.is_empty())
    .map(str::to_owned)
    .unwrap_or_else(|| draft_body_html(request))
}

#[tauri::command]
pub async fn email_case_report(
  app: tauri::AppHandle,
  request: ReportRequest,
  recipient: Option<String>,
  custom: Option<CustomDraft>,
) -> Result<ReportOutcome, String> {
  use tauri::Manager;
  let photo_count = request.photos.len();
  // The mailto fallback copies the PDF somewhere the clinician can attach
  // it from; Downloads is where a mail app's attach dialog starts.
  let download_dir = app.path().download_dir().ok();
  // The Windows compose window is modal — MAPISendMailW blocks until the
  // clinician closes it — and sync commands run on the main thread, so the
  // handoff must go to the blocking pool or the app and tray freeze for the
  // life of the draft.
  let result = tauri::async_runtime::spawn_blocking(move || {
    email_case_report_inner(request, recipient, custom, download_dir)
  })
  .await
  .map_err(|e| format!("Email draft task failed: {e}"))?;
  // Diagnostics stay patient-free (counts only), as for report generation.
  match result {
    Ok(outcome) => {
      crate::diagnostics::record(
        crate::diagnostics::Level::Info,
        "report",
        &format!(
          "Email draft handed to the mail client ({} photos, {} pages)",
          photo_count, outcome.page_count
        ),
        None,
      );
      Ok(outcome)
    }
    Err(e) => {
      crate::diagnostics::record(crate::diagnostics::Level::Error, "report", &e, None);
      Err(e)
    }
  }
}

/// Drafts are a few MB each; sweep leftovers older than a day on every
/// handoff instead of tracking deletion across mail clients that read the
/// staged file at unpredictable times. ponytail: full temp-dir scan per
/// send; upgrade path is an in-memory set of paths this process staged.
fn sweep_stale_drafts() {
  let cutoff = std::time::SystemTime::now()
    .checked_sub(std::time::Duration::from_secs(24 * 60 * 60));
  let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
    return;
  };
  for entry in entries.flatten() {
    if entry.file_name().to_string_lossy().starts_with("camog-report-draft-") {
      if let (Ok(meta), Some(cutoff)) = (entry.metadata(), cutoff) {
        if meta.modified().map(|m| m < cutoff).unwrap_or(false) {
          let _ = std::fs::remove_file(entry.path());
        }
      }
    }
  }
}

fn email_case_report_inner(
  mut request: ReportRequest,
  recipient: Option<String>,
  custom: Option<CustomDraft>,
  download_dir: Option<std::path::PathBuf>,
) -> Result<ReportOutcome, String> {
  sweep_stale_drafts();
  let recipient = recipient
    .as_deref()
    .map(sanitise_recipient)
    .filter(|r| !r.is_empty());
  // The compose dialog always sends its fields; an empty/whitespace subject
  // or body falls back to the built-in defaults so a cleared box reads as
  // "start from the standard wording", not "send a blank email".
  let subject = custom
    .as_ref()
    .map(|c| sanitise_subject(&c.subject))
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| draft_subject(&request.patient_name));
  // Simple MAPI and mailto: carry plain text only, so a custom HTML body is
  // converted once here for those two Windows handoffs (the .eml fallback
  // uses the HTML verbatim instead).
  #[cfg(target_os = "windows")]
  let custom_body_text = custom
    .as_ref()
    .map(|c| html_to_text(&c.body_html))
    .filter(|b| !b.trim().is_empty());
  let stamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let pdf_path = std::env::temp_dir().join(format!("camog-report-draft-{stamp}.pdf"));
  request.save_path = pdf_path.to_string_lossy().into_owned();

  // Byte-identical to the Save PDF output: same renderer, same request.
  // Only the Windows branches below annotate how the draft left the device.
  #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
  let mut outcome = generate_case_report_inner(request.clone())?;
  let pdf =
    std::fs::read(&pdf_path).map_err(|e| format!("Could not read back the generated PDF: {e}"))?;
  let attachment_name = draft_attachment_name(&request.patient_name);

  #[cfg(target_os = "windows")]
  {
    // Simple MAPI needs a registered desktop client (classic Outlook,
    // Thunderbird…). "New Outlook for Windows" and webmail-only machines
    // have none, and the mapi32 stub then answers with the shell's "There
    // is no email program associated…" dialog. Detect that up front and
    // stage an .eml draft instead, so the clinician never sees that
    // dead end.
    if mapi::available() {
      let body = custom_body_text.unwrap_or_else(|| draft_body_text(&request));
      let result = mapi::send_mail(
        &subject,
        &body,
        recipient.as_deref(),
        &pdf_path.to_string_lossy(),
        &attachment_name,
      );
      let _ = &pdf; // read back for the .eml paths only
      result?;
      outcome.handoff = Some(String::from("mapi"));
      Ok(outcome)
    } else {
      // No MAPI client: stage the same .eml the macOS side uses — the HTML
      // body and the embedded PDF both survive, and the machine's .eml
      // handler (new Outlook registers one) opens the message to Send or
      // Forward. Only when no app claims .eml does the mailto: path take
      // over.
      let html_body = eml_html_body(custom.as_ref(), &request);
      let eml_path = std::env::temp_dir().join(format!("camog-report-draft-{stamp}.eml"));
      let eml = build_eml(
        &subject,
        recipient.as_deref(),
        &html_body,
        &attachment_name,
        &pdf,
      );
      std::fs::write(&eml_path, eml)
        .map_err(|e| format!("Could not stage the email draft: {e}"))?;
      match win_shell::open_default(&eml_path.to_string_lossy()) {
        Ok(()) => {
          // The .eml embeds the PDF bytes; nothing needs the temp copy.
          let _ = std::fs::remove_file(&pdf_path);
          crate::diagnostics::record(
            crate::diagnostics::Level::Info,
            "report",
            "No MAPI client — .eml draft opened (HTML body + attached PDF)",
            None,
          );
          outcome.handoff = Some(String::from("eml"));
          Ok(outcome)
        }
        Err(e) => {
          // No .eml association on this PC: drop the staged draft and fall
          // back to mailto:, which saves the PDF to Downloads for a manual
          // attach.
          crate::diagnostics::record(
            crate::diagnostics::Level::Info,
            "report",
            &format!("No .eml handler — falling back to mailto: {e}"),
            None,
          );
          let _ = std::fs::remove_file(&eml_path);
          outcome.handoff = Some(String::from(mailto_fallback(
            &request,
            &subject,
            custom_body_text,
            recipient.as_deref(),
            &pdf_path,
            &attachment_name,
            download_dir.as_deref(),
          )?));
          Ok(outcome)
        }
      }
    }
  }

  #[cfg(target_os = "macos")]
  {
    let _ = &download_dir; // used by the Windows fallbacks only
    let html_body = eml_html_body(custom.as_ref(), &request);
    let eml_path = std::env::temp_dir().join(format!("camog-report-draft-{stamp}.eml"));
    let eml = build_eml(
      &subject,
      recipient.as_deref(),
      &html_body,
      &attachment_name,
      &pdf,
    );
    std::fs::write(&eml_path, eml)
      .map_err(|e| format!("Could not stage the email draft: {e}"))?;
    // The .eml embeds the PDF bytes; Mail never opens the file itself.
    let _ = std::fs::remove_file(&pdf_path);
    std::process::Command::new("open")
      .arg(&eml_path)
      .spawn()
      .map_err(|e| format!("Could not open Mail: {e}"))?;
    Ok(outcome)
  }

  #[cfg(all(unix, not(target_os = "macos"), not(target_os = "windows")))]
  {
    let _ = (pdf, attachment_name, recipient, custom, download_dir, outcome, &pdf_path, subject);
    let _ = std::fs::remove_file(&pdf_path);
    Err(String::from("Email drafts are available on Windows and macOS."))
  }
}

// ---- mailto fallback (Windows machines without a MAPI client) ----

/// Percent-encode for a mailto: URL query (RFC 3986 unreserved characters
/// pass through; everything else, including spaces and newlines, escapes).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // test-covered; used by the Windows mailto handoff
fn percent_encode(value: &str) -> String {
  let mut out = String::with_capacity(value.len());
  for byte in value.bytes() {
    match byte {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
        out.push(byte as char)
      }
      _ => out.push_str(&format!("%{byte:02X}")),
    }
  }
  out
}

/// The compose handoff every Windows mail app understands: To/subject/body
/// prefilled. mailto: cannot carry attachments — mailto_fallback saves the
/// PDF to Downloads alongside this.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // test-covered; used by the Windows mailto handoff
fn mailto_url(recipient: Option<&str>, subject: &str, body: &str) -> String {
  let mut url = String::from("mailto:");
  if let Some(to) = recipient {
    url.push_str(&percent_encode(to));
  }
  url.push_str("?subject=");
  url.push_str(&percent_encode(subject));
  url.push_str("&body=");
  // Normalise to LF first so a literal CRLF already in free text can't
  // double-expand to CR CR LF.
  url.push_str(&percent_encode(&body.replace("\r\n", "\n").replace('\n', "\r\n")));
  url
}

/// Plain-text body for the mailto fallback. Cannot claim the PDF "is
/// attached" (mailto: has no attachments): it names the saved file instead.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // test-covered; used by the Windows mailto handoff
fn draft_body_text_mailto(req: &ReportRequest, attachment_name: &str) -> String {
  let mut body = format!(
    "A clinical photo report for {} is saved on this computer as \"{attachment_name}\" — attach it before sending.\n\nPrepared by: {}\nPrepared: {}\nPhotos: {}",
    req.patient_name, req.prepared_by, req.prepared_at, req.photo_count_label
  );
  if let Some(timeline) = &req.timeline_label {
    body.push_str(&format!("\nTimeline: {timeline}"));
  }
  body.push_str(&format!("\nConsent on record: {}", req.consent_label));
  body
}

/// dir/name.pdf, suffixed " (2)", " (3)"… when a file already exists, so a
/// second draft for the same patient never silently overwrites the first.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))] // test-covered; used by the Windows mailto handoff
fn unique_download_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
  let direct = dir.join(name);
  if !direct.exists() {
    return direct;
  }
  let stem = name.strip_suffix(".pdf").unwrap_or(name);
  for n in 2.. {
    let candidate = dir.join(format!("{stem} ({n}).pdf"));
    if !candidate.exists() {
      return candidate;
    }
  }
  unreachable!("the u64 counter cannot run out")
}

/// Last-resort no-MAPI handoff (this PC has no .eml handler either): copy
/// the PDF into Downloads (revealed in the file
/// manager, because the clinician must attach it manually) and open a
/// mailto: compose in whatever Mail app the machine defaults to. `subject`
/// and `custom_body_text` carry the compose dialog's custom wording when
/// present (plain text — mailto: cannot carry HTML); the defaults fill in
/// otherwise. Returns the handoff kind for the webview's toast copy:
/// "mailto" when the compose window opened, "saved-only" when even mailto:
/// has no association (the PDF + open folder is still a complete manual
/// flow).
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn mailto_fallback(
  request: &ReportRequest,
  subject: &str,
  custom_body_text: Option<String>,
  recipient: Option<&str>,
  pdf_path: &std::path::Path,
  attachment_name: &str,
  download_dir: Option<&std::path::Path>,
) -> Result<&'static str, String> {
  // Keep the PDF attachable: Downloads when it exists, otherwise the temp
  // copy the report was rendered into. A failed copy must be visible — the
  // toasts can only say "saved on this computer", so support needs the log
  // line to know it actually landed in temp.
  let kept = download_dir
    .filter(|d| d.is_dir())
    .map(|d| unique_download_path(d, attachment_name))
    .and_then(|p| match std::fs::copy(pdf_path, &p) {
      Ok(_) => Some(p),
      Err(e) => {
        crate::diagnostics::record(
          crate::diagnostics::Level::Error,
          "report",
          &format!("Could not copy the report PDF into the Downloads folder: {e}"),
          None,
        );
        None
      }
    })
    .unwrap_or_else(|| pdf_path.to_path_buf());
  crate::diagnostics::record(
    crate::diagnostics::Level::Info,
    "report",
    "No MAPI mail client registered — falling back to mailto (PDF saved for manual attach)",
    None,
  );
  if let Err(e) = reveal_in_file_manager(&kept.to_string_lossy()) {
    // Cosmetic: the compose body still names the file.
    crate::diagnostics::record(crate::diagnostics::Level::Error, "report", &e, None);
  }
  // A custom body replaces the stock wording wholesale: the clinician
  // authored it, and this path's "attach the saved PDF" instruction already
  // lives in the toast, not the body.
  let body = custom_body_text.unwrap_or_else(|| draft_body_text_mailto(request, attachment_name));
  let url = mailto_url(recipient, subject, &body);
  match win_shell::open_default(&url) {
    Ok(()) => Ok("mailto"),
    Err(e) => {
      crate::diagnostics::record(
        crate::diagnostics::Level::Error,
        "report",
        &format!("mailto handoff failed: {e}"),
        None,
      );
      Ok("saved-only")
    }
  }
}

/// Minimal shell hand-FFI: ShellExecuteW's "open" verb launches a URL with
/// its default handler (mailto: → the default Mail app). Kept hand-rolled
/// alongside the mapi32 binding to avoid a windows-rs dependency; a return
/// value <= 32 means the launch failed (31 = no association for it).
#[cfg(target_os = "windows")]
mod win_shell {
  use std::ffi::c_void;
  use std::os::raw::c_int;

  const SW_SHOWNORMAL: c_int = 1;

  #[link(name = "shell32")]
  extern "system" {
    fn ShellExecuteW(
      hwnd: *mut c_void,
      verb: *const u16,
      file: *const u16,
      parameters: *const u16,
      directory: *const u16,
      show: c_int,
    ) -> isize;
  }

  /// UTF-16, NUL-terminated.
  fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
  }

  pub fn open_default(url: &str) -> Result<(), String> {
    let verb = wide("open");
    let file = wide(url);
    let code = unsafe {
      ShellExecuteW(
        std::ptr::null_mut(),
        verb.as_ptr(),
        file.as_ptr(),
        std::ptr::null(),
        std::ptr::null(),
        SW_SHOWNORMAL,
      )
    };
    if code > 32 {
      Ok(())
    } else {
      Err(format!("Windows could not open a handler for it (ShellExecute code {code})"))
    }
  }
}

/// Registry reads for the MAPI pre-check (advapi32, string values only).
#[cfg(target_os = "windows")]
mod registry {
  use std::ffi::c_void;
  use std::os::raw::{c_int, c_ulong};

  pub const HKEY_CURRENT_USER: *mut c_void = 0x8000_0001usize as *mut c_void;
  pub const HKEY_LOCAL_MACHINE: *mut c_void = 0x8000_0002usize as *mut c_void;

  const RRF_RT_REG_SZ: c_ulong = 0x0000_0002;
  const RRF_RT_REG_EXPAND_SZ: c_ulong = 0x0000_0004;
  /// Accept either string type; REG_EXPAND_SZ is auto-expanded in place
  /// (DllPath entries historically use it).
  const RESTRICTIONS: c_ulong = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;

  #[link(name = "advapi32")]
  extern "system" {
    fn RegGetValueW(
      key: *mut c_void,
      sub_key: *const u16,
      value: *const u16,
      flags: c_ulong,
      ty: *mut c_ulong,
      data: *mut c_void,
      cb_data: *mut c_ulong,
    ) -> c_int; // LSTATUS; 0 = ERROR_SUCCESS
  }

  /// A non-empty string value (REG_SZ/REG_EXPAND_SZ), None when the key or
  /// value is missing or not a string. An empty `value` reads the key's
  /// default entry.
  pub fn reg_sz(root: *mut c_void, sub_key: &str, value: &str) -> Option<String> {
    let sub = sub_key.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
    let val = value.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
    let mut buf = [0u16; 1024];
    let mut ty: c_ulong = 0;
    let mut cb = (buf.len() * std::mem::size_of::<u16>()) as c_ulong;
    let status = unsafe {
      RegGetValueW(
        root,
        sub.as_ptr(),
        val.as_ptr(),
        RESTRICTIONS,
        &mut ty,
        buf.as_mut_ptr().cast(),
        &mut cb,
      )
    };
    if status != 0 {
      return None;
    }
    let len = ((cb as usize) / std::mem::size_of::<u16>()).min(buf.len());
    let end = buf[..len].iter().position(|&c| c == 0).unwrap_or(len);
    let s = String::from_utf16_lossy(&buf[..end]);
    (!s.is_empty()).then_some(s)
  }
}

/// Minimal Simple MAPI binding, Unicode variant (MAPISendMailW, Windows 8+):
/// just enough to open a reviewed compose window with one attachment in the
/// clinician's own mail client. Hand-rolled FFI (kernel32 + mapi32, plus
/// shell32/advapi32 for the no-MAPI fallback) to avoid a windows-rs
/// dependency; the struct layout is pinned by a test.
/// ponytail: if this grows past one recipient / plain text (e.g. HTML bodies
/// via extended MAPI), switch to the windows crate.
#[cfg(target_os = "windows")]
mod mapi {
  use std::ffi::{c_void, CString};
  use std::os::raw::c_char;
  use std::os::raw::c_ulong;

  use super::registry::{self, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

  pub const MAPI_LOGON_UI: c_ulong = 0x0000_0001;
  pub const MAPI_DIALOG: c_ulong = 0x0000_0008;
  const MAPI_TO: c_ulong = 1;
  const SUCCESS_SUCCESS: c_ulong = 0;
  const MAPI_E_USER_ABORT: c_ulong = 1; // compose window closed unsent

  /// Is a MAPI-capable mail client registered for this user? Mirrors what
  /// the mapi32 stub itself resolves: the default mail client named under
  /// HKCU\Software\Clients\Mail (falling back to HKLM), then that client's
  /// DllPathEx/DllPath provider entry. Machines without one — "new Outlook
  /// for Windows" only, webmail-only setups — cannot serve MAPISendMailW,
  /// and calling it anyway surfaces the shell's "There is no email program
  /// associated…" dialog, so callers check this first.
  pub fn available() -> bool {
    let roots = [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];
    let client = roots
      .iter()
      .find_map(|root| registry::reg_sz(*root, r"Software\Clients\Mail", ""))
      .filter(|name| !name.trim().is_empty());
    let Some(client) = client else {
      return false;
    };
    roots.iter().any(|root| {
      let key = format!(r"Software\Clients\Mail\{client}");
      registry::reg_sz(*root, &key, "DllPathEx")
        .or_else(|| registry::reg_sz(*root, &key, "DllPath"))
        .is_some()
    })
  }

  #[repr(C)]
  #[derive(Clone, Copy)]
  pub struct MapiRecipDescW {
    pub reserved: c_ulong,
    pub recip_class: c_ulong,
    pub name: *mut u16,
    pub address: *mut u16,
    pub entry_size: c_ulong,
    pub entry_id: *mut c_void,
  }

  #[repr(C)]
  #[derive(Clone, Copy)]
  pub struct MapiFileDescW {
    pub reserved: c_ulong,
    pub flags: c_ulong,
    pub position: c_ulong,
    pub path_name: *mut u16,
    pub file_name: *mut u16,
    pub file_type: *mut c_void,
  }

  #[repr(C)]
  pub struct MapiMessageW {
    pub reserved: c_ulong,
    pub subject: *mut u16,
    pub note_text: *mut u16,
    pub message_type: *mut u16,
    pub date_received: *mut u16,
    pub conversation_id: *mut u16,
    pub flags: c_ulong,
    pub originator: *mut MapiRecipDescW,
    pub recip_count: c_ulong,
    pub recips: *mut MapiRecipDescW,
    pub file_count: c_ulong,
    pub files: *mut MapiFileDescW,
  }

  type MapiSendMailW =
    unsafe extern "system" fn(usize, usize, *mut MapiMessageW, c_ulong, c_ulong) -> c_ulong;

  /// UTF-16, NUL-terminated.
  fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
  }

  /// Open the default mail client's compose window with the attachment,
  /// prefilled subject/body and optional To: recipient. Blocks until the
  /// compose window closes.
  pub fn send_mail(
    subject: &str,
    body: &str,
    recipient: Option<&str>,
    attachment_path: &str,
    attachment_name: &str,
  ) -> Result<(), String> {
    extern "system" {
      fn LoadLibraryW(filename: *const u16) -> isize;
      fn GetProcAddress(module: isize, name: *const c_char) -> *mut c_void;
      fn FreeLibrary(module: isize);
    }

    let subject_w = wide(subject);
    let body_w = wide(body);
    let path_w = wide(attachment_path);
    let name_w = wide(attachment_name);

    let mut recip = MapiRecipDescW {
      reserved: 0,
      recip_class: MAPI_TO,
      name: std::ptr::null_mut(),
      address: std::ptr::null_mut(),
      entry_id: std::ptr::null_mut(),
      entry_size: 0,
    };
    let recipient_w = recipient.map(wide);
    if let Some(w) = &recipient_w {
      recip.name = w.as_ptr() as *mut u16;
    }
    let (recip_count, recips) = if recipient_w.is_some() {
      (1 as c_ulong, &mut recip as *mut MapiRecipDescW)
    } else {
      (0, std::ptr::null_mut())
    };

    let mut file = MapiFileDescW {
      reserved: 0,
      flags: 0,
      position: c_ulong::MAX, // attachment goes at the end of the body
      path_name: path_w.as_ptr() as *mut u16,
      file_name: name_w.as_ptr() as *mut u16,
      file_type: std::ptr::null_mut(),
    };
    let mut message = MapiMessageW {
      reserved: 0,
      subject: subject_w.as_ptr() as *mut u16,
      note_text: body_w.as_ptr() as *mut u16,
      message_type: std::ptr::null_mut(),
      date_received: std::ptr::null_mut(),
      conversation_id: std::ptr::null_mut(),
      flags: 0,
      originator: std::ptr::null_mut(),
      recip_count,
      recips,
      file_count: 1,
      files: &mut file,
    };

    let dll: Vec<u16> = "mapi32.dll\0".encode_utf16().collect();
    let module = unsafe { LoadLibraryW(dll.as_ptr()) };
    if module == 0 {
      return Err(String::from(
        "Windows MAPI (mapi32.dll) could not be loaded. You can use Save PDF and attach the file yourself.",
      ));
    }
    let proc_name = CString::new("MAPISendMailW").expect("no interior NUL");
    let proc = unsafe { GetProcAddress(module, proc_name.as_ptr()) };
    if proc.is_null() {
      unsafe { FreeLibrary(module) };
      return Err(String::from(
        "This Windows version lacks the Unicode MAPI entry point. You can use Save PDF and attach the file yourself.",
      ));
    }
    let send: MapiSendMailW = unsafe { std::mem::transmute(proc) };
    let code = unsafe { send(0, 0, &mut message, MAPI_DIALOG | MAPI_LOGON_UI, 0) };
    unsafe { FreeLibrary(module) };

    match code {
      SUCCESS_SUCCESS | MAPI_E_USER_ABORT => Ok(()),
      other => Err(format!(
        "The mail client could not open a draft (MAPI error {other}). You can use Save PDF and attach the file yourself."
      )),
    }
  }
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
  fn detail_diagram_tables_cover_every_part_with_a_zoom_view() {
    // Every part except the chip-only torso has a diagram on both faces, and
    // hands/feet draw distinct palm/back (top/sole) shapes — matching
    // hasPartDetail in part-detail-diagram.tsx.
    for part in [
      "head", "face", "scalp", "neck", "chest", "abdomen", "back", "upper_arm",
      "forearm", "hand", "thigh", "leg", "foot",
    ] {
      assert!(!detail_shapes(part, "front").is_empty(), "{part} front is empty");
      assert!(!detail_shapes(part, "back").is_empty(), "{part} back is empty");
    }
    assert!(detail_shapes("torso", "front").is_empty());
    assert!(detail_shapes("nonsense", "front").is_empty());
    // The two-faced parts branch per face; the rest share one table.
    assert!(!std::ptr::eq(detail_shapes("hand", "front"), detail_shapes("hand", "back")));
    assert!(!std::ptr::eq(detail_shapes("foot", "front"), detail_shapes("foot", "back")));
    assert!(std::ptr::eq(detail_shapes("face", "front"), detail_shapes("face", "back")));
    // Every shape in every table builds into a path.
    for part in ["head", "hand", "foot", "back"] {
      for view in ["front", "back"] {
        for shape in detail_shapes(part, view) {
          assert!(detail_shape_path(shape).is_some(), "{part}/{view} shape failed");
        }
      }
    }
  }

  #[test]
  fn series_heading_lines_fit_column_and_count_members() {
    let f = load_fonts();
    // One member and many read naturally.
    assert_eq!(series_heading_lines("Short", 1, &f), vec!["Short (1 photo)"]);
    assert_eq!(series_heading_lines("Short", 3, &f), vec!["Short (3 photos)"]);
    // A long clinician-authored name (up to 100 chars) wraps inside the
    // content column instead of running off the page.
    let long = "Left cheek mole near the jawline first photographed in March ".repeat(2);
    let lines = series_heading_lines(&long, 3, &f);
    assert!(lines.len() >= 2, "long name must wrap: {lines:?}");
    for line in &lines {
      assert!(
        f.medium.width(line, 10.0) <= CONTENT_W + 1.0,
        "heading line overflows: {line:?}"
      );
    }
    // Height tracks the wrapped line count, so pagination stays exact.
    assert_eq!(
      series_heading_height(&long, 3, &f),
      25.0 + lines.len() as f32 * 12.0
    );
  }

  #[test]
  fn renders_multipage_pdf_with_stable_pagination() {
    let sample = include_bytes!("../testdata/sample.jpg");
    let photo_meta: Vec<ReportPhoto> = (0..7)
      .map(|i| {
        // Photo 0 is a right hand marked on the back-of-hand detail diagram,
        // exercising the part detail table, the mirroring and the X in the
        // exact-spot path; the rest are plain face photos.
        let hand = i == 0;
        ReportPhoto {
          path: format!("/tmp/photo-{i}.jpg"),
          captured_label: format!("{:02}/03/2024", i + 1),
          body_part: String::from(if hand { "Right hand" } else { "Face" }),
          body_part_key: Some(String::from(if hand { "hand" } else { "face" })),
          laterality: hand.then(|| String::from("right")),
          pin_x: hand.then_some(0.55),
          pin_y: hand.then_some(0.6),
          pin_space: hand.then(|| String::from("part")),
          pin_view: hand.then(|| String::from("back")),
          subpart: Some(String::from(if hand { "Dorsum" } else { "Cheek" })),
          clinical_notes: Some(String::from(
            "Review photo. Border appears stable compared with the previous capture; no ulceration.",
          )),
          // Photos 3 and 4 form one series block: the heading draws once where
          // the block opens and the second photo continues without one.
          series_label: (2..=3).contains(&i).then(|| String::from("Left cheek mole review")),
        }
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

  #[test]
  fn recipient_is_stripped_of_header_breaking_whitespace() {
    // Trust boundary: the stored patient email arrives over IPC; a newline
    // must never reach a MIME header or smuggle extra recipients.
    assert_eq!(
      sanitise_recipient("patient@example.com\nBcc: x@example.com"),
      "patient@example.comBcc:x@example.com"
    );
    assert_eq!(sanitise_recipient("  a@b.com "), "a@b.com");
  }

  #[test]
  fn custom_subject_cannot_break_mime_headers() {
    // Trust boundary: the compose dialog's subject arrives over IPC and
    // lands in headers downstream — CR/LF/NUL must go.
    assert_eq!(
      sanitise_subject("Hi\r\nBcc: someone@evil.example"),
      "HiBcc: someone@evil.example"
    );
    assert_eq!(sanitise_subject("  Report for Amina \n"), "Report for Amina");
    assert_eq!(sanitise_subject("\0"), "");
  }

  #[test]
  fn html_to_text_keeps_prose_breaks_lines_and_decodes_entities() {
    let html = "<html><body style=\"x:y\">\n\
      <p>A clinical photo report for <strong>Amina &amp; Co</strong> is attached.</p>\n\
      <ul>\n  <li>Prepared by: Dr&nbsp;Whitlam</li>\n  <li>Photos: 3</li>\n</ul>\n\
      <p>Second paragraph &lt;after&gt; escaping &#39;kept&#39;.</p>\n\
      </body></html>";
    let text = html_to_text(html);
    assert!(text.contains("Amina & Co"), "&amp; must decode: {text}");
    assert!(!text.contains("<strong>"), "tags must be dropped: {text}");
    assert!(text.contains("Dr\u{a0}Whitlam"), "&nbsp; must decode: {text}");
    assert!(text.contains("<after> escaping 'kept'."), "entities must decode: {text}");
    // Block tags break lines; indentation between them is trimmed and blank
    // runs collapse, so the body reads as typed prose.
    let lines: Vec<&str> = text.lines().collect();
    assert!(lines.contains(&"A clinical photo report for Amina & Co is attached."), "{lines:?}");
    assert!(lines.contains(&"Prepared by: Dr\u{a0}Whitlam"), "{lines:?}");
    assert!(lines.contains(&"Photos: 3"), "{lines:?}");
    assert!(lines.iter().all(|l| *l == l.trim()), "no tag indentation: {lines:?}");
    assert!(text.starts_with("A clinical"), "no leading blanks: {text:?}");
    assert!(text.ends_with("escaping 'kept'."), "no trailing blanks: {text:?}");
  }

  #[test]
  fn html_to_text_converts_br_and_collapses_blank_runs() {
    assert_eq!(html_to_text("one<br>two<br/>three"), "one\ntwo\nthree");
    assert_eq!(html_to_text("<p>a</p>\n\n\n<p>b</p>"), "a\n\nb");
    assert_eq!(html_to_text(""), "");
  }

  #[test]
  fn html_to_text_leaves_an_ampersand_literal() {
    // &amp; decodes last: "&amp;lt;" is the typed text "&lt;", not "<".
    assert_eq!(html_to_text("R &amp;lt; Q"), "R &lt; Q");
    assert_eq!(html_to_text("a &amp; b"), "a & b");
  }

  #[test]
  fn attachment_name_tracks_the_webviews_file_sanitiser() {
    assert_eq!(
      draft_attachment_name("Amina: Fouad/lekka"),
      "Camog case report - Amina Fouad lekka.pdf"
    );
    assert_eq!(
      draft_attachment_name("  Double  spaces  "),
      "Camog case report - Double spaces.pdf"
    );
  }

  #[test]
  fn percent_encode_escapes_everything_but_unreserved() {
    assert_eq!(percent_encode("Dr-Smith_09.~z"), "Dr-Smith_09.~z");
    assert_eq!(percent_encode("a b"), "a%20b");
    assert_eq!(percent_encode("line\nbreak"), "line%0Abreak");
    // Non-ASCII escapes as its UTF-8 bytes (é = C3 A9).
    assert_eq!(percent_encode("é"), "%C3%A9");
    assert_eq!(percent_encode("a&b=c?d"), "a%26b%3Dc%3Fd");
  }

  #[test]
  fn mailto_url_carries_recipient_subject_and_body() {
    let url = mailto_url(
      Some("patient@example.com"),
      "Clinical photo report — Amina",
      "line one\nline two",
    );
    assert!(url.starts_with("mailto:patient%40example.com?subject="), "{url}");
    assert!(url.contains("&body=line%20one%0D%0Aline%20two"), "{url}");
    // The em dash survives as UTF-8 escapes; newlines become CRLF pairs.
    assert!(url.contains("%E2%80%94"), "{url}");
    // A literal CRLF in free text must not double-expand to CR CR LF.
    assert_eq!(mailto_url(None, "s", "a\r\nb").matches("%0D%0D").count(), 0);
    assert!(mailto_url(None, "s", "a\r\nb").ends_with("a%0D%0Ab"));
    // Without a stored patient email the compose opens with a blank To:.
    let no_to = mailto_url(None, "s", "b");
    assert!(no_to.starts_with("mailto:?subject=s&body=b"), "{no_to}");
  }

  #[test]
  fn mailto_body_names_the_saved_file_not_an_attachment() {
    let req = ReportRequest {
      save_path: String::new(),
      patient_name: String::from("Amina Fouad"),
      date_of_birth: None,
      treating_clinician: None,
      prepared_by: String::from("Dr Sarah Whitlam"),
      prepared_at: String::from("25/08/2026, 2:05 pm"),
      consent_label: String::from("Clinical care"),
      consent_valid: true,
      photo_count_label: String::from("3 photos"),
      timeline_label: None,
      photos: vec![],
    };
    let body = draft_body_text_mailto(&req, "Camog case report - Amina Fouad.pdf");
    // mailto: cannot attach: the body must point at the saved file instead
    // of claiming an attachment that isn't there.
    assert!(!body.contains("is attached as a PDF"), "{body}");
    assert!(body.contains("attach it before sending"), "{body}");
    assert!(body.contains("\"Camog case report - Amina Fouad.pdf\""), "{body}");
    assert!(body.contains("Dr Sarah Whitlam"), "{body}");
  }

  #[test]
  fn unique_download_path_suffixes_instead_of_overwriting() {
    let dir = std::env::temp_dir().join(format!(
      "camog-dl-test-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    let name = "Camog case report - Test.pdf";
    assert_eq!(
      unique_download_path(&dir, name),
      dir.join(name),
      "first save takes the plain name"
    );
    std::fs::write(dir.join(name), b"x").expect("seed collision");
    assert_eq!(
      unique_download_path(&dir, name),
      dir.join("Camog case report - Test (2).pdf"),
      "existing file pushes the next save to (2)"
    );
    std::fs::write(dir.join("Camog case report - Test (2).pdf"), b"x").expect("seed collision");
    assert_eq!(
      unique_download_path(&dir, name),
      dir.join("Camog case report - Test (3).pdf")
    );
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn plain_text_body_carries_the_report_facts() {
    let req = ReportRequest {
      save_path: String::new(),
      patient_name: String::from("Amina Fouad"),
      date_of_birth: None,
      treating_clinician: None,
      prepared_by: String::from("Dr Sarah Whitlam"),
      prepared_at: String::from("25/08/2026, 2:05 pm"),
      consent_label: String::from("Clinical care"),
      consent_valid: true,
      photo_count_label: String::from("3 photos"),
      timeline_label: Some(String::from("01/03/2024 to 07/03/2024")),
      photos: vec![],
    };
    let body = draft_body_text(&req);
    assert!(body.contains("attached as a PDF"));
    assert!(body.contains("Dr Sarah Whitlam"));
    assert!(body.contains("3 photos"));
    assert!(body.contains("01/03/2024 to 07/03/2024"));
    assert!(body.contains("Clinical care"));
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn eml_draft_encodes_headers_escapes_html_and_attaches_the_pdf() {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let req = ReportRequest {
      save_path: String::new(),
      // HTML metacharacters must arrive escaped in the HTML body.
      patient_name: String::from("Amina <Fouad> & Sons"),
      date_of_birth: None,
      treating_clinician: None,
      prepared_by: String::from("Dr Sarah Whitlam"),
      prepared_at: String::from("25/08/2026, 2:05 pm"),
      consent_label: String::from("Clinical care"),
      consent_valid: true,
      photo_count_label: String::from("3 photos"),
      timeline_label: None,
      photos: vec![],
    };
    let html = draft_body_html(&req);
    assert!(html.contains("Amina &lt;Fouad&gt; &amp; Sons"), "{html}");
    assert!(!html.contains("<Fouad>"), "{html}");

    let pdf_bytes = b"%PDF-1.7 tiny fixture";
    let eml = build_eml(
      &draft_subject("Amina Fouad"),
      Some("patient@example.com"),
      &html,
      "Camog case report - Amina Fouad.pdf",
      pdf_bytes,
    );
    assert!(eml.starts_with("To: patient@example.com\n"), "{eml}");
    // RFC 2047 subject decodes back to the exact string (em dash survives).
    let encoded_subject = eml
      .lines()
      .find(|l| l.starts_with("Subject: "))
      .unwrap()
      .strip_prefix("Subject: =?utf-8?B?")
      .unwrap()
      .strip_suffix("?=")
      .unwrap();
    assert_eq!(
      STANDARD.decode(encoded_subject).unwrap(),
      draft_subject("Amina Fouad").into_bytes()
    );
    assert!(eml.contains("X-Unsent: 1"));
    assert!(eml.contains("Content-Type: application/pdf"));
    assert!(eml.contains(
      "Content-Disposition: attachment; filename=\"Camog case report - Amina Fouad.pdf\""
    ));
    assert!(eml.contains(&STANDARD.encode(pdf_bytes)));
    assert!(eml.trim_end().ends_with("--camog-draft-boundary-2b7f41--"));
  }

  #[cfg(all(test, target_os = "windows"))]
  mod mapi_layout {
    use super::super::mapi::*;
    use std::os::raw::c_void;
    use std::os::raw::c_ulong;

    fn void_ptr() -> *mut c_void {
      std::ptr::null_mut()
    }

    // The structs must mirror win32/x64 exactly: u32 fields pad to the next
    // pointer boundary. A mismatch here means the FFI drifted from win32.
    // (40/40/96 with 4-byte c_ulong — 48/48 would be the LP64/macOS layout.)
    #[test]
    fn ffi_struct_sizes_match_win32_x64() {
      assert_eq!(std::mem::size_of::<c_ulong>(), 4);
      let _ = void_ptr();
      assert_eq!(std::mem::size_of::<MapiRecipDescW>(), 40);
      assert_eq!(std::mem::size_of::<MapiFileDescW>(), 40);
      assert_eq!(std::mem::size_of::<MapiMessageW>(), 96);
      assert_eq!(std::mem::align_of::<MapiMessageW>(), 8);
    }
  }
}
