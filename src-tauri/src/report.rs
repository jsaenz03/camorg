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
  let regions: &[MapRegion] = if view == "back" { &BACK_MAP } else { &FRONT_MAP };
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
  let photo_count = request.photos.len();
  // Recorded for Settings → Diagnostics; messages must stay patient-free
  // (counts and pages only).
  match generate_case_report_inner(request) {
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
  Ok(ReportOutcome { page_count: pages })
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

  result.map_err(|e| {
    let msg = format!("Could not open the file manager: {e}");
    crate::diagnostics::record(crate::diagnostics::Level::Error, "reveal", &msg, None);
    msg
  })
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
}
