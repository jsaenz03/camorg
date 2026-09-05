// The companion phone page served at the pairing URL. Kept as a separate
// included file so remote_camera.rs stays readable; everything here ships to
// the phone as one static HTML document (no external assets, no build step).

const PAGE_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f4f4f5" id="meta-theme">
<title>Camog &middot; Phone link</title>
<!-- Home-screen app: the manifest + icon let the phone add Camog to its home
     screen with the app logo (iOS via apple-touch-icon, Android via the
     manifest served by the tether server). -->
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="logo.png">
<link rel="icon" type="image/png" href="logo.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Camog">
<style>
  /* Camog theme — mirrors app/globals.css tokens. Light is the default
     (new phones start light); body.theme-dark flips to the dark palette,
     remembered per phone. Every surface reads these tokens, so the whole
     page — camera, library, viewer, compare chrome — follows the toggle. */
  :root {
    color-scheme: dark;
    --bg: #0a0a0a;
    --card: #171717;
    --fg: #fafafa;
    --muted: #a1a1aa;
    --border: rgba(255, 255, 255, 0.1);
    --overlay: rgba(10, 10, 10, 0.92);
    --primary: #00aeb5;    /* oklch(0.68 0.12 200) */
    --primary-fg: #001011; /* oklch(0.16 0.02 200) */
    --primary-soft: rgba(0, 174, 181, 0.12);
    --success: #4ade80;
    --warn: #fbbf24;
    --error: #f87171;
    --radius: 10px;        /* 0.625rem */
  }
  body.light {
    color-scheme: light;
    --bg: #f4f4f5;
    --card: #ffffff;
    --fg: #18181b;
    --muted: #52525b;
    --border: rgba(0, 0, 0, 0.1);
    --overlay: rgba(244, 244, 245, 0.94);
    --primary: #007b82;    /* oklch(0.52 0.11 200) */
    --primary-fg: #ffffff;
    --primary-soft: rgba(0, 123, 130, 0.10);
    --success: #16a34a;
    --warn: #b45309;
    --error: #dc2626;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; height: 100dvh; overflow: hidden; overscroll-behavior: none;
    position: relative; /* containing block for the absolute boot splash */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(70% 40% at 50% 0, var(--primary-soft), transparent 70%) var(--bg);
    color: var(--fg);
    -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  /* A double-tap is a fast review tap, not a zoom request; iOS only honours
     this per-element (user-scalable=no is ignored), and the pinch itself is
     refused via gesturestart in the script below. */
  button, label, input, select { touch-action: manipulation; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  [hidden] { display: none !important; }

  /* Screens: the document itself never scrolls — the body is a fixed-height
     shell and each screen scrolls internally (overscroll contained), so the
     fixed tab bar and theme button stay anchored instead of bouncing with
     the page's rubber band, and lists stop short of the bar via padding. */
  .screen {
    height: 100%; overflow-y: auto; overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  #screen-cam {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; justify-content: safe center;
    gap: 20px;
    padding: calc(24px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
  }
  #screen-lib, #screen-patient, #screen-all {
    padding: calc(16px + env(safe-area-inset-top)) 16px calc(76px + env(safe-area-inset-bottom));
  }

  header { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  header img {
    width: 56px; height: 56px; padding: 6px;
    border-radius: 14px; border: 1px solid var(--border);
    background: var(--card); object-fit: contain;
  }
  .wordmark { font-size: 20px; font-weight: 600; line-height: 1.2; text-align: center; }
  .tagline { font-size: 13px; color: var(--muted); text-align: center; }
  h1 { font-size: 20px; margin: 0; text-align: center; }
  h2 { font-size: 18px; margin: 0; }
  p { font-size: 15px; line-height: 1.5; color: var(--muted); margin: 0; text-align: center; max-width: 36ch; }
  .check {
    width: 64px; height: 64px; border-radius: 999px; color: var(--primary);
    display: flex; align-items: center; justify-content: center;
    background: var(--primary-soft);
  }
  .check svg { width: 30px; height: 30px; }
  .btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; max-width: 340px; min-height: 48px; padding: 13px 16px; border: 0; border-radius: var(--radius);
    font-size: 17px; font-weight: 600; text-align: center; cursor: pointer;
    -webkit-user-select: none; user-select: none;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  .btn:active { transform: scale(0.98); opacity: 0.85; }
  .btn-primary { background: var(--primary); color: var(--primary-fg); }
  .btn-secondary { background: #27272a; color: var(--fg); }
  body.light .btn-secondary { background: #e4e4e7; }
  .btn-outline {
    background: transparent; color: var(--fg); border: 1px solid var(--border);
  }
  .btn[disabled] { opacity: 0.55; pointer-events: none; }
  .btn svg { width: 18px; height: 18px; flex: none; }
  #screen-start, #screen-review, #screen-sent {
    display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%;
  }
  #preview { max-width: 100%; max-height: 50dvh; border-radius: 12px; object-fit: contain; border: 1px solid var(--border); }
  #error { color: var(--error); white-space: pre-line; padding: 0 16px; }

  /* Theme toggle: fixed top-right, hidden while a full-screen surface is
     open — and until boot settles (see updateChrome): WebKit composites a
     fixed element at whatever viewport offset was current when it FIRST
     paints, so it must not exist in the paint until the cold-start viewport
     has settled. */
  #theme {
    position: fixed; z-index: 6; right: 10px; top: calc(10px + env(safe-area-inset-top));
    width: 44px; height: 44px; border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    color: var(--muted); background: var(--card); border: 1px solid var(--border);
    transition: color 0.15s ease;
  }
  #theme svg { width: 20px; height: 20px; }
  body.theme-dark #theme .i-sun { display: block; }
  body.theme-dark #theme .i-moon { display: none; }
  body:not(.theme-dark) #theme .i-sun { display: none; }
  body:not(.theme-dark) #theme .i-moon { display: block; }

  /* Boot splash: the breathing-logo loading notice. It owns the first
     paint until the link answers, so the full UI reveals in one pass. It
     is position:absolute (not fixed) on purpose: WebKit's cold start
     composites FIXED elements at the pre-settle viewport and never fully
     re-composites them — the very bug that shifted the page upward — so
     the splash rides the document instead and self-corrects with it. */
  #boot {
    position: absolute; inset: 0; z-index: 40;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; padding: 24px;
    background: var(--bg);
    transition: opacity 0.25s ease;
  }
  #boot.gone { opacity: 0; pointer-events: none; }
  #boot img {
    width: 72px; height: 72px; padding: 9px;
    border-radius: 18px; border: 1px solid var(--border);
    background: var(--card); object-fit: contain;
    animation: breathe 2.4s ease-in-out infinite;
  }
  #boot p { margin: 0; }
  @keyframes breathe {
    0%, 100% { transform: scale(1); opacity: 0.7; }
    50% { transform: scale(1.08); opacity: 1; }
  }

  /* Bottom tab bar. */
  #tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
    display: flex; justify-content: center; gap: 8px;
    padding: 6px 16px calc(6px + env(safe-area-inset-bottom));
    background: var(--overlay);
    -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
  }  .tab {
    flex: 1; max-width: 180px; min-height: 52px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    font-size: 12px; font-weight: 500; color: var(--muted); border-radius: var(--radius);
    transition: color 0.15s ease;
  }
  .tab svg { width: 22px; height: 22px; }
  .tab[aria-selected="true"] { color: var(--primary); }

  /* Library list. */
  .topbar {
    display: flex; align-items: center; gap: 4px; min-height: 48px; margin-bottom: 8px;
    /* padding keeps the row clear of the fixed theme toggle at top right */
    padding-right: 52px;
    /* Narrow phones: the sort controls wrap under the title instead of
       being squeezed out of view. */
    flex-wrap: wrap;
  }
  .topbar h2 { flex: 1 1 auto; min-width: 0; text-align: left; }
  /* Patients sort: compact select riding the list topbar (compare-picker style).
     16px text: smaller inputs make iOS zoom the page on focus. */
  #sort {
    flex: none; min-height: 38px; padding: 0 4px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--card); color: var(--fg);
    font-size: 16px;
  }
  /* Direction flip: the arrow names the current order (up = A–Z / soonest). */
  #sort-dir .i-desc { display: none; }
  #sort-dir[data-dir="desc"] .i-asc { display: none; }
  #sort-dir[data-dir="desc"] .i-desc { display: block; }
  .iconbtn {
    width: 44px; height: 44px; border-radius: var(--radius);
    display: flex; align-items: center; justify-content: center; color: var(--muted);
    transition: background 0.15s ease;
  }
  .iconbtn:active { background: #27272a; }
  body.light .iconbtn:active { background: #e4e4e7; }
  .iconbtn svg { width: 20px; height: 20px; }
  .textbtn {
    min-height: 44px; padding: 0 12px; border-radius: var(--radius);
    display: flex; align-items: center; gap: 6px;
    font-size: 15px; font-weight: 600; color: var(--primary);
  }
  .textbtn:active { opacity: 0.7; }
  .textbtn[disabled] { color: var(--muted); pointer-events: none; }
  .textbtn svg { width: 18px; height: 18px; }
  #search, #all-search {
    width: 100%; min-height: 44px; padding: 10px 14px; margin-bottom: 8px;
    border-radius: var(--radius); border: 1px solid var(--border); background: var(--card);
    color: var(--fg); font-size: 16px; /* 16px+ so iOS never zooms the field */
  }
  #search::placeholder, #all-search::placeholder { color: var(--muted); }
  #patients { display: flex; flex-direction: column; }
  .patient-row {
    display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    min-height: 64px; padding: 10px 4px; border-bottom: 1px solid var(--border);
    transition: background 0.15s ease;
  }
  .patient-row:active { background: #1c1c1f; }
  body.light .patient-row:active { background: #e9e9ec; }
  .patient-row .name { font-size: 16px; font-weight: 600; }
  .patient-row .meta { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .patient-row .grow { flex: 1; min-width: 0; }
  .patient-row .chev { color: var(--muted); flex: none; }
  /* Card flags render as small pills (same treatment as the viewer's review
     chip) so each status reads at a glance against the row's name/meta text;
     quiet ones stay neutral — a far-out date shouldn't shout. */
  .flag {
    display: inline-block; font-size: 12px; font-weight: 600;
    padding: 3px 9px; margin: 3px 4px 0 0; border-radius: 999px;
  }
  .flag-overdue { color: var(--error); background: rgba(220, 38, 38, 0.12); }
  .flag-warn { color: var(--warn); background: rgba(180, 83, 9, 0.14); }
  .flag-quiet {
    color: var(--muted); font-weight: 500;
    background: rgba(127, 127, 127, 0.15);
  }

  /* Patient detail. */
  #patient-meta { text-align: left; max-width: none; }
  /* Stacked full-width: three actions (camera, phone library, report) would
     crush each other side by side on a phone. */
  #patient-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  #patient-actions .btn { max-width: none; font-size: 15px; min-height: 44px; padding: 10px 8px; }
  #patient-status { min-height: 20px; margin-top: 8px; font-size: 13px; color: var(--muted); text-align: left; }
  #patient-status.ok { color: var(--success); }
  #patient-status.err { color: var(--error); }

  /* Capture-for chip: the patient the camera is shooting for (set from the
     patient screen's Take photo; the X hands the camera back to unaddressed
     snaps). Reads like the desktop's capture-for-patient context. */
  #capture-for {
    display: flex; align-items: center; gap: 8px; max-width: 340px;
    padding: 6px 6px 6px 14px; border-radius: 999px;
    font-size: 13px; font-weight: 600; color: var(--primary);
    background: var(--primary-soft);
  }
  #capture-for-clear {
    width: 26px; height: 26px; border-radius: 999px; flex: none;
    display: flex; align-items: center; justify-content: center;
    color: var(--primary); background: rgba(127, 127, 127, 0.18);
  }
  #capture-for-clear svg { width: 14px; height: 14px; }

  /* Patient detail lines (DOB, treating clinician, consent scope). */
  #patient-detail { text-align: left; }
  #patient-detail div { font-size: 13px; color: var(--muted); margin-top: 2px; max-width: none; }

  /* Photo grid (per-patient and all-photos). */
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 8px; }
  .grid button {
    display: block; position: relative; width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
    background: var(--card);
  }
  .grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Body-map indicator: where on the patient this photo was taken. */
  .grid .cell-fig {
    position: absolute; right: 3px; bottom: 3px; width: 24px;
    background: rgba(0, 0, 0, 0.55); border-radius: 5px; padding: 2px;
    pointer-events: none;
  }
  /* Patient-name chip (all-photos grid, where rows mix patients). */
  .grid .cell-name {
    position: absolute; left: 3px; bottom: 3px; max-width: calc(100% - 34px);
    padding: 2px 6px; border-radius: 5px; background: rgba(0, 0, 0, 0.55); color: #fafafa;
    font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; pointer-events: none;
  }
  /* Review flag: dot on photos that need review (overdue red, due-soon amber). */
  .grid .cell-review {
    position: absolute; top: 4px; right: 4px; width: 10px; height: 10px; border-radius: 999px;
    pointer-events: none;
  }
  .grid .cell-review.overdue { background: #f87171; }
  .grid .cell-review.due-soon { background: #fbbf24; }
  .empty { padding: 48px 12px; text-align: center; color: var(--muted); font-size: 15px; }

  /* Due-review banner (patients + photos tabs): mirrors the desktop's
     review-due badge — red while any review is overdue, amber while merely
     due soon, quiet card once everything scheduled is beyond the window. */
  .due-banner {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 9px 12px; margin-bottom: 8px; border-radius: var(--radius);
    font-size: 13px; font-weight: 500; line-height: 1.4;
  }
  .due-banner svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }
  .due-banner.overdue { color: var(--error); background: rgba(220, 38, 38, 0.12); }
  .due-banner.due { color: var(--warn); background: rgba(180, 83, 9, 0.14); }
  .due-banner.quiet {
    color: var(--muted); background: var(--card); border: 1px solid var(--border);
  }

  /* Full-screen surfaces (cover the tab bar). Both follow the theme like
     every other screen; only the photo stages inside them stay black in
     both themes — photos read best on black (same as the desktop dialog). */
  #screen-viewer, #screen-compare {
    position: fixed; inset: 0; z-index: 20;
    display: flex; flex-direction: column;
  }
  #screen-viewer, #screen-compare { background: var(--bg); }
  .surface-top {
    display: flex; align-items: center; gap: 8px; padding: 8px 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
  }
  #screen-viewer .iconbtn, #screen-compare .iconbtn { color: var(--fg); }
  #screen-viewer .iconbtn:active, #screen-compare .iconbtn:active {
    background: rgba(127, 127, 127, 0.18);
  }
  #viewer-top .count { flex: 1; text-align: center; font-size: 14px; color: var(--muted); }
  #stage {
    flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
    overflow: hidden; touch-action: pan-y;
  }
  #stage img {
    max-width: 100%; max-height: 100%; object-fit: contain;
    transition: transform 0.2s ease, filter 0.2s ease;
  }
  #stage.zoomed img { transform: scale(2.4); }
  #stage.blurred img { filter: blur(22px); }
  #viewer-meta {
    display: flex; flex-direction: column; gap: 10px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: var(--card); border-top: 1px solid var(--border);
    color: var(--fg);
  }
  #viewer-meta .txt { flex: 1; min-width: 0; }
  #viewer-meta .line1 { font-size: 15px; font-weight: 600; }
  #viewer-meta .line2 { font-size: 13px; color: var(--muted); margin-top: 3px; }
  #viewer-meta .notes { font-size: 14px; opacity: 0.85; margin-top: 8px; line-height: 1.45; }

  /* Photo review strip (desktop-dialog parity); chips read on both themes. */
  #viewer-review-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 36px; }
  #viewer-review-btn { margin-left: auto; }
  #viewer-flag {
    font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
    white-space: nowrap;
  }
  #viewer-flag.overdue { color: var(--error); background: rgba(220, 38, 38, 0.12); }
  #viewer-flag.due-soon { color: var(--warn); background: rgba(180, 83, 9, 0.14); }
  #viewer-flag.scheduled, #viewer-flag.stale { color: var(--muted); background: rgba(127, 127, 127, 0.15); }
  #viewer-last { font-size: 13px; color: var(--muted); }
  #viewer-review-status { font-size: 13px; color: var(--muted); }
  #viewer-review-status.err { color: var(--error); }
  /* Stacked: three choices (camera snap, phone library, nothing) would
     crush side by side in the viewer's meta panel. */
  .offer-row { display: flex; flex-direction: column; gap: 8px; }
  .offer-row .btn { flex: none; max-width: none; font-size: 15px; min-height: 44px; padding: 10px 8px; }
  .offer-hint { font-size: 13px; color: var(--muted); text-align: left; max-width: none; }

  /* Body map figure (geometry shared with the desktop picker). */
  .bodyfig { display: block; }
  .bodyfig [data-part] { fill: rgba(161, 161, 170, 0.30); stroke: rgba(161, 161, 170, 0.5); stroke-width: 1.5; }
  .bodyfig [data-part].hl { fill: var(--primary); stroke: var(--primary); }

  /* Compare (mirrors the desktop dialog): two pickers, side-by-side or
     overlay modes, an anchor toggle (linked = one shared zoom + pan across
     both photos, free = each pane on its own). The chrome follows the
     theme; the photo panes stay black in both. */
  #compare-title { flex: 1; text-align: center; font-size: 16px; font-weight: 600; }
  #compare-controls { padding: 0 10px 8px; display: flex; flex-direction: column; gap: 8px; }
  .cmp-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cmp-pickers label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 3px; }
  .cmp-pickers select {
    width: 100%; min-height: 40px; padding: 6px 8px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--card); color: var(--fg); font-size: 16px;
  }
  .cmp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cmp-mode { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .cmp-mode button {
    min-height: 38px; padding: 0 10px; font-size: 13px; font-weight: 600; color: var(--muted);
    display: flex; align-items: center; gap: 5px;
  }
  .cmp-mode button[aria-pressed="true"] { background: var(--primary); color: var(--primary-fg); }
  .cmp-mode svg { width: 15px; height: 15px; }
  .cmp-anchor {
    min-height: 38px; padding: 0 10px; font-size: 13px; font-weight: 600; color: var(--muted);
    display: flex; align-items: center; gap: 5px;
    border: 1px solid var(--border); border-radius: 8px;
  }
  .cmp-anchor[aria-pressed="true"] { background: var(--primary); color: var(--primary-fg); }
  .cmp-anchor svg { width: 15px; height: 15px; }
  .cmp-zoom { margin-left: auto; display: flex; align-items: center; gap: 4px; color: var(--fg); }
  .cmp-zoom .pct { min-width: 40px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
  .cmp-zoom button {
    width: 38px; height: 38px; border-radius: 8px; color: var(--fg);
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--border);
  }
  .cmp-zoom svg { width: 16px; height: 16px; }
  #cmp-opacity-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  #cmp-opacity { flex: 1; accent-color: var(--primary); }
  #compare-stage { flex: 1; min-height: 0; padding: 0 8px 8px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
  #cmp-frame { height: 100%; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; height: 100%; }
  .cmp-pane {
    position: relative; display: flex; align-items: center; justify-content: center;
    overflow: hidden; background: #000; touch-action: none;
  }
  .cmp-pane img, .cmp-overlay img {
    max-width: 100%; max-height: 100%; object-fit: contain; user-select: none;
    -webkit-user-select: none; transition: transform 0.08s linear;
  }
  .cmp-pane .chip, .cmp-overlay .chip {
    position: absolute; left: 6px; bottom: 6px; padding: 3px 7px; border-radius: 6px;
    background: rgba(0, 0, 0, 0.6); color: #fafafa; font-size: 11px; pointer-events: none;
  }
  .cmp-overlay {
    position: relative; height: 100%; display: flex; align-items: center; justify-content: center;
    overflow: hidden; background: #000; touch-action: none;
  }
  .cmp-overlay img {
    position: absolute; transition: transform 0.08s linear, opacity 0.1s linear;
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
    #boot img { animation: none; }
  }
</style>
</head>
<body class="light">
  <!-- Loading notice: shown until the link answers (see the boot section
       at the end of the script); then the real UI reveals in one pass. -->
  <div id="boot" role="status">
    <img src="logo.png" alt="">
    <p id="boot-msg">Connecting to Camog&hellip;</p>
  </div>

  <!-- Camera -->
  <main id="screen-cam" class="screen">
    <div id="screen-start" style="width:100%">
      <header>
        <img src="logo.png" alt="Camog">
        <div>
          <div class="wordmark">Camog</div>
          <div class="tagline">Clinical Photos</div>
        </div>
      </header>
      <p id="conn">Connecting to Camog&hellip;</p>
      <div id="capture-for" hidden>
        <span id="capture-for-name"></span>
        <button type="button" id="capture-for-clear" aria-label="Stop capturing for this patient">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <label class="btn btn-primary" for="photo">Take photo</label>
      <input id="photo" type="file" accept="image/*" capture="environment" hidden>
      <label class="btn btn-secondary" for="pick">Send from library</label>
      <input id="pick" type="file" accept="image/*" multiple hidden>
    </div>
    <div id="screen-review" hidden style="width:100%">
      <h1 id="review-title">Use this photo?</h1>
      <img id="preview" alt="Photo to send">
      <button type="button" class="btn btn-primary" id="send">Send to Camog</button>
      <button type="button" class="btn btn-secondary" id="retake">Retake</button>
    </div>
    <div id="screen-sent" hidden style="width:100%">
      <div class="check" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <h1>Photo sent</h1>
      <p id="sent-hint">Check Camog on your computer to add details and save it.</p>
      <button type="button" class="btn btn-primary" id="another">Take another photo</button>
      <button type="button" class="btn btn-secondary" id="sent-lib" hidden>Open patients</button>
    </div>
    <p id="error"></p>
    <button type="button" class="btn btn-outline" id="relink" hidden>Link options</button>
  </main>

  <!-- Patients: patient list -->
  <main id="screen-lib" class="screen" hidden>
    <div class="topbar">
      <h2>Patients</h2>
      <select id="sort" aria-label="Sort patients">
        <option value="review">Review due</option>
        <option value="recent">Recent</option>
        <option value="name">Name A&ndash;Z</option>
        <option value="photos">Most photos</option>
      </select>
      <button type="button" class="iconbtn" id="sort-dir" data-dir="asc" aria-label="Sorted ascending. Tap for descending">
        <svg class="i-asc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
        <svg class="i-desc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
      </button>
      <button type="button" class="iconbtn" id="refresh" aria-label="Refresh patients">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
      </button>
    </div>
    <div id="lib-due" class="due-banner" role="status" hidden></div>
    <input id="search" type="search" placeholder="Search patients" autocomplete="off" aria-label="Search patients">
    <div id="patients" role="list"></div>
    <div id="lib-empty" class="empty" hidden>No patients to show yet.</div>
  </main>

  <!-- Photos: every patient's photos, newest first (like the desktop Photos page) -->
  <main id="screen-all" class="screen" hidden>
    <div class="topbar">
      <h2>All photos</h2>
      <button type="button" class="iconbtn" id="all-refresh" aria-label="Refresh photos">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
      </button>
    </div>
    <div id="all-due" class="due-banner" role="status" hidden></div>
    <input id="all-search" type="search" placeholder="Search patient or body part" autocomplete="off" aria-label="Search photos">
    <div id="all-grid" class="grid"></div>
    <div id="all-empty" class="empty" hidden>No photos to show yet.</div>
  </main>

  <!-- Library: one patient's photos -->
  <main id="screen-patient" class="screen" hidden>
    <div class="topbar">
      <button type="button" class="iconbtn" id="back" aria-label="Back to library">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <h2 id="patient-name"></h2>
      <button type="button" class="textbtn" id="compare-btn" disabled>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></svg>
        <span id="compare-label">Compare</span>
      </button>
    </div>
    <p id="patient-meta"></p>
    <div id="patient-detail"></div>
    <div id="patient-actions">
      <button type="button" class="btn btn-primary" id="patient-capture">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
        Take photo
      </button>
      <button type="button" class="btn btn-secondary" id="patient-pick">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        Send from library
      </button>
      <button type="button" class="btn btn-outline" id="report-btn">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        Case report
      </button>
    </div>
    <p id="patient-status" aria-live="polite"></p>
    <div id="grid" class="grid"></div>
  </main>

  <!-- Full-screen viewer -->
  <div id="screen-viewer" role="dialog" aria-label="Photo viewer" hidden>
    <div id="viewer-top" class="surface-top">
      <button type="button" class="iconbtn" id="viewer-back" aria-label="Close photo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <span class="count" id="viewer-count"></span>
      <button type="button" class="iconbtn" id="blur-btn" aria-label="Blur photo for privacy" aria-pressed="false">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
      </button>
    </div>
    <div id="stage">
      <img id="viewer-img" alt="Clinical photo">
    </div>
    <div id="viewer-meta">
      <div class="txt">
        <div class="line1" id="viewer-title"></div>
        <div class="line2" id="viewer-date"></div>
        <div class="notes" id="viewer-notes" hidden></div>
      </div>
      <!-- Photo review (desktop-dialog parity): status banner, then Mark
           reviewed asks whether to snap the follow-up photo here. -->
      <div id="viewer-review">
        <div id="viewer-review-row">
          <span id="viewer-flag" hidden></span>
          <span id="viewer-last" hidden></span>
          <button type="button" class="textbtn" id="viewer-review-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
            Mark reviewed
          </button>
        </div>
        <div class="offer-row" id="viewer-offer" hidden>
          <button type="button" class="btn btn-primary" id="photo-review-snap">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            Snap photo
          </button>
          <button type="button" class="btn btn-secondary" id="photo-review-library">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            Send from library
          </button>
          <button type="button" class="btn btn-outline" id="photo-review-plain">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
            No photo needed
          </button>
        </div>
        <p class="offer-hint" id="viewer-offer-hint" hidden>Snap or pick the follow-up on this phone &mdash; saving it on your computer links it into this photo&rsquo;s series.</p>
        <span id="viewer-review-status" hidden></span>
      </div>
    </div>
  </div>

  <!-- Compare (like the desktop dialog): pickers + side/overlay + anchor toggle + pan/zoom -->
  <div id="screen-compare" role="dialog" aria-label="Compare photos" hidden>
    <div class="surface-top">
      <button type="button" class="iconbtn" id="compare-back" aria-label="Close compare">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <span id="compare-title">Compare</span>
    </div>
    <div id="compare-controls">
      <div class="cmp-pickers">
        <div>
          <label for="cmp-left">Earlier / reference</label>
          <select id="cmp-left" aria-label="Photo to compare, earlier"></select>
        </div>
        <div>
          <label for="cmp-right">Later / current</label>
          <select id="cmp-right" aria-label="Photo to compare, later"></select>
        </div>
      </div>
      <div class="cmp-row">
        <div class="cmp-mode" role="group" aria-label="Compare mode">
          <button type="button" id="mode-side" aria-pressed="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></svg>
            Side
          </button>
          <button type="button" id="mode-overlay" aria-pressed="false">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>
            Overlay
          </button>
        </div>
        <button type="button" id="cmp-anchor" class="cmp-anchor" aria-pressed="true" aria-label="Anchor panes together" title="Linked: pan and zoom move both photos together. Free: move each photo on its own.">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>
          <span id="cmp-anchor-label">Linked</span>
        </button>
        <div class="cmp-zoom">
          <button type="button" id="zoom-out" aria-label="Zoom out">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>
          </button>
          <span class="pct" id="zoom-pct">100%</span>
          <button type="button" id="zoom-in" aria-label="Zoom in">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/><path d="M11 8v6"/></svg>
          </button>
          <button type="button" id="zoom-reset" aria-label="Reset zoom and pan">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
        </div>
      </div>
      <div id="cmp-opacity-row" hidden>
        <span id="cmp-opacity-label">Overlay opacity</span>
        <input id="cmp-opacity" type="range" min="0" max="100" value="50" aria-labelledby="cmp-opacity-label">
      </div>
    </div>
    <div id="compare-stage">
      <div id="cmp-frame"></div>
    </div>
  </div>

  <button type="button" id="theme" aria-label="Switch light or dark appearance" hidden>
    <svg class="i-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
    <svg class="i-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>

  <nav id="tabbar" role="tablist" aria-label="Sections" hidden>
    <button type="button" class="tab" id="tab-cam" role="tab" aria-selected="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
      Camera
    </button>
    <button type="button" class="tab" id="tab-all" role="tab" aria-selected="false" hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
      Photos
    </button>
    <button type="button" class="tab" id="tab-lib" role="tab" aria-selected="false" hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Patients
    </button>
  </nav>

<script>
(function () {
  'use strict';
  var pending = null; // processed JPEG blob waiting to be sent
  var lib = null;     // shared library manifest from the desktop, or null

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.hidden = !on; }
  function fail(msg) { $('error').textContent = msg; }
  // The start screen's status line: the normal connected guidance, or a
  // transient note (the review follow-up's "send this to link it") that
  // drops back to the default once the photo it describes is sent — so the
  // camera never reads like it is stuck repeating an old instruction.
  var CONN_DEFAULT = 'Connected. Take the photo, review it, then send it.';
  function setConn(note) {
    $('conn').textContent = note || CONN_DEFAULT;
    $('conn').style.color = 'var(--success)';
  }

  // ---- Theme (light is the default; the choice persists on the phone) -----
  var THEME_KEY = 'camog-theme';
  function applyTheme(light) {
    document.body.classList.toggle('light', light);
    document.body.classList.toggle('theme-dark', !light);
    $('meta-theme').setAttribute('content', light ? '#f4f4f5' : '#0a0a0a');
  }
  applyTheme(localStorage.getItem(THEME_KEY) !== 'dark');
  $('theme').addEventListener('click', function () {
    var light = !document.body.classList.contains('light');
    applyTheme(light);
    try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (e) { /* private mode */ }
  });

  // iOS reads a pinch as a page zoom (it ignores user-scalable=no); photo
  // review wants the pixels untouched, so the gestures are refused outright.
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); });

  // ---- Date formatting (d MMM yyyy, no locale surprises across devices) --
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ---- Body map figure (geometry shared with the desktop picker) ---------
  // Shapes carry their screen side; the front view mirrors, so the patient's
  // right limb appears on the viewer's left (same convention as a photo).
  var BILATERAL = { upper_arm: 1, forearm: 1, hand: 1, thigh: 1, leg: 1, foot: 1 };
  var BODY_FRONT =
    '<ellipse data-part="head" data-screen="center" cx="100" cy="46" rx="26" ry="32"/>' +
    '<rect data-part="chest" data-screen="center" x="76" y="84" width="48" height="38" rx="10"/>' +
    '<rect data-part="abdomen" data-screen="center" x="78" y="124" width="44" height="44" rx="10"/>' +
    '<rect data-part="upper_arm" data-screen="left" x="48" y="88" width="20" height="46" rx="10"/>' +
    '<rect data-part="upper_arm" data-screen="right" x="132" y="88" width="20" height="46" rx="10"/>' +
    '<rect data-part="forearm" data-screen="left" x="46" y="138" width="18" height="44" rx="9"/>' +
    '<rect data-part="forearm" data-screen="right" x="136" y="138" width="18" height="44" rx="9"/>' +
    '<ellipse data-part="hand" data-screen="left" cx="55" cy="194" rx="11" ry="13"/>' +
    '<ellipse data-part="hand" data-screen="right" cx="145" cy="194" rx="11" ry="13"/>' +
    '<rect data-part="thigh" data-screen="left" x="78" y="172" width="20" height="56" rx="10"/>' +
    '<rect data-part="thigh" data-screen="right" x="102" y="172" width="20" height="56" rx="10"/>' +
    '<rect data-part="leg" data-screen="left" x="78" y="232" width="18" height="52" rx="9"/>' +
    '<rect data-part="leg" data-screen="right" x="104" y="232" width="18" height="52" rx="9"/>' +
    '<ellipse data-part="foot" data-screen="left" cx="84" cy="296" rx="11" ry="9"/>' +
    '<ellipse data-part="foot" data-screen="right" cx="116" cy="296" rx="11" ry="9"/>' +
    '<ellipse data-part="face" data-screen="center" cx="100" cy="54" rx="17" ry="21"/>' +
    '<rect data-part="scalp" data-screen="center" x="82" y="14" width="36" height="12" rx="6"/>' +
    '<rect data-part="neck" data-screen="center" x="90" y="74" width="20" height="14" rx="5"/>';
  var BODY_BACK =
    '<ellipse data-part="head" data-screen="center" cx="100" cy="46" rx="26" ry="32"/>' +
    '<rect data-part="back" data-screen="center" x="76" y="84" width="48" height="84" rx="10"/>' +
    '<rect data-part="upper_arm" data-screen="left" x="48" y="88" width="20" height="46" rx="10"/>' +
    '<rect data-part="upper_arm" data-screen="right" x="132" y="88" width="20" height="46" rx="10"/>' +
    '<rect data-part="forearm" data-screen="left" x="46" y="138" width="18" height="44" rx="9"/>' +
    '<rect data-part="forearm" data-screen="right" x="136" y="138" width="18" height="44" rx="9"/>' +
    '<ellipse data-part="hand" data-screen="left" cx="55" cy="194" rx="11" ry="13"/>' +
    '<ellipse data-part="hand" data-screen="right" cx="145" cy="194" rx="11" ry="13"/>' +
    '<rect data-part="thigh" data-screen="left" x="78" y="172" width="20" height="56" rx="10"/>' +
    '<rect data-part="thigh" data-screen="right" x="102" y="172" width="20" height="56" rx="10"/>' +
    '<rect data-part="leg" data-screen="left" x="78" y="232" width="18" height="52" rx="9"/>' +
    '<rect data-part="leg" data-screen="right" x="104" y="232" width="18" height="52" rx="9"/>' +
    '<ellipse data-part="foot" data-screen="left" cx="84" cy="296" rx="11" ry="9"/>' +
    '<ellipse data-part="foot" data-screen="right" cx="116" cy="296" rx="11" ry="9"/>' +
    '<ellipse data-part="scalp" data-screen="center" cx="100" cy="40" rx="18" ry="16"/>' +
    '<rect data-part="neck" data-screen="center" x="90" y="74" width="20" height="14" rx="5"/>';

  function bodyFigure(part, laterality) {
    var isBack = part === 'back' || part === 'scalp';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 320');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Body map showing where the photo was taken');
    svg.classList.add('bodyfig');
    svg.innerHTML = isBack ? BODY_BACK : BODY_FRONT;
    var shapes = svg.querySelectorAll('[data-part]');
    Array.prototype.forEach.call(shapes, function (el) {
      var p = el.getAttribute('data-part');
      var screen = el.getAttribute('data-screen');
      // Front view mirrors: screen-left is the patient's right.
      var patient = screen === 'center'
        ? 'center'
        : (isBack ? screen : (screen === 'left' ? 'right' : 'left'));
      var hit = p === part &&
        (!laterality || !BILATERAL[p] || patient === laterality);
      if (hit) el.classList.add('hl');
    });
    return svg;
  }

  // ---- Fixed chrome (tab bar + theme button) ------------------------------
  // The bottom bar only makes sense once there is something to navigate to,
  // and NEITHER fixed element may exist in the paint until the splash hands
  // over: WebKit composites a fixed element at whatever viewport offset was
  // current when it first paints, so chrome shown during a settling cold
  // start locked in shifted upward — and a reflow read never re-composites
  // it. updateChrome first runs at the settled moment (a fresh display
  // mutation, right before the splash fades), which lands the chrome in the
  // right place first time; a late viewport settle re-asserts it below.
  var chromeReady = false;
  function updateChrome() {
    var surfaced = !viewerOpen() && !compareOpen();
    $('tabbar').hidden = !chromeReady || !lib || !surfaced;
    show($('theme'), chromeReady && surfaced);
  }

  function fetchLibrary() {
    return fetch('library').then(function (res) { return res.json(); }).then(function (data) {
      lib = data.viewing ? data : null;
      show($('tab-lib'), !!lib);
      show($('tab-all'), !!lib);
      show($('sent-lib'), !!lib);
      // Library went away (sharing turned off, desktop restarted): leave any
      // library screen instead of stranding the phone with no bar to leave by.
      if (!lib && $('screen-cam').hidden) {
        state.patientId = null;
        setTab('cam');
      }
      updateChrome();
      return lib;
    });
  }

  // ---- Live library updates ----------------------------------------------
  // The desktop republishes the manifest the moment anything changes — a
  // review stamp, a rescheduled review, a saved photo — and this held
  // request wakes on the change, so the library tracks the computer
  // action-for-action instead of waiting for a refresh. One wait in flight;
  // it re-arms itself after every answer.
  var watching = false;
  function watchLibrary() {
    if (watching || !lib) return;
    watching = true;
    fetch('library-wait', { cache: 'no-store' }).then(function (res) {
      if (res.status === 404) { pairingExpired(); return null; }
      if (!res.ok) throw new Error('status ' + res.status);
      return res.json();
    }).then(function (data) {
      watching = false;
      if (!data) return; // pairing expired — nothing left to watch
      var job = data.changed
        ? fetchLibrary().then(function () {
            // Redraw whatever is on screen: the surfaces render from the
            // in-memory manifest, so a background update must re-render
            // to be seen (review dates, names, grids).
            if (!$('screen-lib').hidden) renderLibrary();
            else if (!$('screen-patient').hidden) renderGrid();
            else if (!$('screen-all').hidden) renderAll();
          })
        : Promise.resolve();
      return job.catch(function () {}).then(function () {
        if (lib) watchLibrary();
      });
    }).catch(function () {
      watching = false;
      // Desktop unreachable: retry quietly; probe's loop owns the reconnect
      // news (the wait itself only exists while the library is shared).
      setTimeout(function () { if (lib) watchLibrary(); }, 3000);
    });
  }

  // ---- Tabs --------------------------------------------------------------
  function setTab(tab) {
    show($('screen-cam'), tab === 'cam');
    show($('screen-lib'), tab === 'lib' && !state.patientId);
    show($('screen-patient'), tab === 'lib' && !!state.patientId);
    show($('screen-all'), tab === 'all');
    $('tab-cam').setAttribute('aria-selected', tab === 'cam' ? 'true' : 'false');
    $('tab-lib').setAttribute('aria-selected', tab === 'lib' ? 'true' : 'false');
    $('tab-all').setAttribute('aria-selected', tab === 'all' ? 'true' : 'false');
    updateChrome();
    if (tab === 'lib') renderLibrary();
    if (tab === 'all') renderAll();
  }
  $('tab-cam').addEventListener('click', function () { setTab('cam'); });
  $('tab-lib').addEventListener('click', function () { setTab('lib'); });
  $('tab-all').addEventListener('click', function () { setTab('all'); });

  // ---- Connect + initial data --------------------------------------------
  // All fetches are relative, so this source carries no URL or cookie
  // secrets and works wherever the page is mounted. The saved home-screen
  // app may open while the desktop is closed or still starting, so keep
  // pinging until Camog answers (the pinned port and code survive desktop
  // restarts). Once connected, a slow heartbeat keeps the desktop's idle
  // watchdog from ending the session while the page is open, and doubles as
  // the loss detector that re-arms the ping loop.
  var connTimer = null;
  var beatTimer = null;
  // The pairing code itself, remembered once the desktop shares it (same
  // class of secret as the session this page already holds): a saved /t/
  // link lets a dead session heal without anyone re-scanning anything.
  var LINK_KEY = 'camog-link-code';
  var TRIED_KEY = 'camog-link-tried';
  function rememberLink(code) {
    if (!/^[0-9a-f]{16}$/.test(code || '')) return;
    try {
      localStorage.setItem(LINK_KEY, code);
      sessionStorage.removeItem(TRIED_KEY);
    } catch (e) { /* private mode */ }
  }
  function probe() {
    // Statuses matter: a network failure is "cannot reach" (keep retrying),
    // but a 404 while the server still answers means this page's credential
    // is dead — the code was rotated, or the link restarted and sessions
    // died with it. Only a re-scan recovers, so say so instead of retrying.
    fetch('hello').then(function (res) {
      if (res.status === 404) { pairingExpired(); return; }
      if (!res.ok) throw new Error('stale pairing code');
      if (connTimer) { clearInterval(connTimer); connTimer = null; }
      setConn(null);
      fail('');
      show($('relink'), false);
      if (!beatTimer) beatTimer = setInterval(beat, 60000);
      // Keep the self-heal link fresh; the reset also re-arms the link
      // page's one-shot auto-restore now that this link is proven good.
      fetch('link-code').then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { if (data) rememberLink(data.code); })
        .catch(function () { /* healing memory is optional */ });
      fetchLibrary().catch(function () { /* library stays hidden; capture still works */ })
        .then(function (shared) {
          if (shared) watchLibrary();
          reveal();
        });
    }).catch(disconnected);
  }
  function beat() {
    // Hidden pages are throttled anyway and the desktop counts them idle on
    // purpose, so only a visible page keeps the link warm.
    if (document.hidden) return;
    fetch('hello').then(function (res) {
      if (res.status === 404) pairingExpired();
      else if (!res.ok) disconnected();
    }).catch(disconnected);
  }
  function disconnected() {
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    $('conn').textContent = 'Connecting to Camog\u2026';
    $('conn').style.color = '';
    fail('Cannot reach Camog.\nMake sure the Camog app is open and your phone is on the same Wi-Fi.');
    reveal(); // the splash has an answer to show now; keep retrying behind it
    if (!connTimer) connTimer = setInterval(probe, 3000);
  }
  // A dead session cookie never comes back on this page — the exchange lives
  // in the pairing URL — so stop both timers (a tight retry loop would only
  // hammer the desktop's throttle) and say what to do. Foregrounding probes
  // once more, which is enough: re-scanning opens a fresh page anyway.
  function pairingExpired() {
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    if (connTimer) { clearInterval(connTimer); connTimer = null; }
    // The server is clearly alive (it answered 404), so the saved pairing
    // URL is worth one hop: sessions die with every desktop restart but the
    // code does not, and the exchange mints a fresh cookie silently. The
    // tried-flag keeps this a one-shot — a rotated code lands on the link
    // page instead of ping-ponging between the two.
    var code = null;
    var tried = '1';
    try {
      code = localStorage.getItem(LINK_KEY);
      tried = sessionStorage.getItem(TRIED_KEY);
    } catch (e) { /* private mode */ }
    if (code && !tried) {
      try { sessionStorage.setItem(TRIED_KEY, '1'); } catch (e) { /* ignore */ }
      location.href = '/t/' + code + '/';
      return;
    }
    $('conn').textContent = 'Pairing expired.';
    $('conn').style.color = '';
    fail('Pairing expired \u2014 scan the QR in Camog again, or restore the link.');
    show($('relink'), true);
    reveal();
  }
  // ---- Boot: breathing logo until the link answers, then one reveal -------
  // The splash owns the first paint (see #boot in the CSS): the tab bar and
  // other fixed chrome only composite at the settled viewport, so the full
  // UI appears in a single pass once hello/library resolve — or on the first
  // failure, so the error state is never trapped behind it. A saved page may
  // also be restored scrolled; manual restoration keeps the reveal at top.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  var booting = true;
  // WebKit's home-screen cold start sometimes lays the whole document out
  // at the pre-settle viewport (fixed layers locked shifted upward, dvh
  // stale) and never fully re-composites it. A display flip forces a
  // complete relayout + repaint at the real metrics; done synchronously the
  // browser never paints the none-state, and under the splash it is never
  // seen.
  function forceRelayout() {
    var b = document.body;
    b.style.display = 'none';
    void b.offsetHeight;
    b.style.display = '';
  }
  var bootedAt = Date.now();
  function onViewportSettle() {
    // Only during the settle window after boot (an input in focus means
    // the keyboard is resizing the viewport — leave it alone).
    if (!chromeReady || Date.now() - bootedAt > 5000) return;
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    forceRelayout();
    updateChrome();
  }
  window.addEventListener('resize', onViewportSettle);
  if (window.visualViewport) visualViewport.addEventListener('resize', onViewportSettle);

  function reveal() {
    if (!booting) return;
    booting = false;
    // Let the cold-start viewport settle before anything shows: rebuild the
    // document layout at the real metrics (forceRelayout), then composite
    // the fixed chrome at that settled offset — right before the splash
    // fades. The first frame the user sees is the finished layout.
    setTimeout(function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          forceRelayout();
          chromeReady = true;
          updateChrome();
          var boot = $('boot');
          if (!boot) return;
          boot.classList.add('gone');
          setTimeout(function () { boot.remove(); }, 300);
        });
      });
    }, 300);
  }
  // ponytail: escape hatch for a fetch that never settles (hung TCP) —
  // 10s of splash beats an app that never shows up.
  setTimeout(reveal, 10000);
  probe();
  // Coming back to a page that outlived a desktop restart: probe right away
  // instead of waiting for the next tick.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (!beatTimer) probe();
    // Back from suspension: pick up anything that changed while the page
    // was frozen (the held long-poll may have died with its socket).
    fetchLibrary().catch(function () { /* capture-only still works */ })
      .then(function (shared) { if (shared) watchLibrary(); });
  });

  // Tell the desktop when the page goes away so it can clear "connected".
  addEventListener('pagehide', function () { navigator.sendBeacon('bye'); });

  // ---- Capture flow (one POST path for snaps and library picks) -----------
  var flow = 'cam'; // where the photo under review came from: 'cam' | 'pick'
  var pick = { queue: [], total: 0, done: 0 };
  // True while a "Snap photo" follow-up is captured-but-not-yet-sent, so the
  // camera status line and the sent screen describe the series link.
  var snapFollowUp = false;

  function reviewScreen() {
    $('review-title').textContent = pick.total > 1
      ? 'Use this photo? (' + (pick.done + 1) + ' of ' + pick.total + ')'
      : 'Use this photo?';
    $('retake').lastChild.textContent = flow === 'pick' ? 'Discard' : 'Retake';
    camScreen('screen-review');
  }

  function sentScreen() {
    $('another').lastChild.textContent =
      flow === 'pick' ? 'Send more from library' : 'Take another photo';
    camScreen('screen-sent');
  }

  $('photo').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    fail('');
    // Snaps started from the viewer's follow-up offer or a patient screen
    // come back while that surface is still frontmost — the review screens
    // live on the camera tab, so bring it forward (and close a viewer that
    // is still open over it).
    if (viewerOpen()) history.back();
    if ($('screen-cam').hidden) setTab('cam');
    flow = 'cam';
    pick = { queue: [], total: 0, done: 0 };
    shrink(file).then(function (blob) {
      pending = blob;
      $('preview').src = URL.createObjectURL(blob);
      reviewScreen();
    }).catch(function () {
      fail('Could not read that photo. Try again.');
    });
  });

  // Send from library: pick one or more existing photos and review them one
  // at a time (like the desktop upload dialog), then send each down the same
  // POST path as a camera snap.
  $('pick').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (!files.length) return;
    fail('');
    // Opened from the viewer's follow-up offer or a patient screen: the
    // review screens live on the camera tab, so bring it forward (and
    // close a viewer that is still open over it).
    if (viewerOpen()) history.back();
    if ($('screen-cam').hidden) setTab('cam');
    flow = 'pick';
    pick = { queue: files, total: files.length, done: 0 };
    prepNext();
  });

  function prepNext() {
    var file = pick.queue.shift();
    shrink(file).then(function (blob) {
      pending = blob;
      $('preview').src = URL.createObjectURL(blob);
      reviewScreen();
    }).catch(function () {
      fail('Could not read one of those photos \u2014 it was skipped.');
      advancePick();
    });
  }

  function advancePick() {
    pick.done += 1;
    if (pick.queue.length) prepNext();
    else sentScreen();
  }

  function camScreen(id) {
    ['screen-start', 'screen-review', 'screen-sent'].forEach(function (s) {
      show($(s), s === id);
    });
  }

  $('retake').addEventListener('click', function () {
    if (flow === 'pick') advancePick();
    else camScreen('screen-start');
  });
  $('another').addEventListener('click', function () { camScreen('screen-start'); });
  $('sent-lib').addEventListener('click', function () { setTab('lib'); });

  // One id per send: if the phone's network stack silently retries the POST
  // (a dropped connection can replay it below the app), the retry carries the
  // same id and the computer drops the duplicate instead of staging the photo
  // twice. crypto.randomUUID needs iOS 15.4; older engines fall back.
  function newCaptureId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  $('send').addEventListener('click', function () {
    if (!pending) return;
    var blob = pending;
    pending = null;
    fail('');
    var headers = { 'X-Capture-Id': newCaptureId() };
    // Capturing for a patient (the chip on the start screen): the desktop
    // prefills the photo's metadata form from the id, so the snap arrives
    // already addressed to their record.
    if (capturePatientId) headers['X-Patient-Id'] = capturePatientId;
    fetch('photo', {
      method: 'POST',
      headers: headers,
      body: blob,
    }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      if (snapFollowUp) {
        snapFollowUp = false;
        $('sent-hint').textContent =
          'Saving it on your computer links it into the reviewed photo\u2019s series.';
      } else {
        $('sent-hint').textContent = 'Check Camog on your computer to add details and save it.';
      }
      setConn(null); // the note has served; the next snap reads clean
      if (flow === 'pick') advancePick();
      else sentScreen();
    }).catch(function () {
      pending = blob;
      fail('Could not send the photo.\nMake sure Camog is still open, then try again.');
      reviewScreen();
    });
  });

  // ---- Capture for a patient (from the patient screen) --------------------
  // "Take photo" on a patient's screen opens the camera directly and
  // addresses every snap to that patient until cleared — the photos land on
  // the computer with the metadata form prefilled instead of relying on a
  // retyped name. The association survives across photos (a consult shoots
  // several); the chip on the start screen shows and clears it.
  var capturePatientId = null;
  function setCapturePatient(id) {
    capturePatientId = id;
    var chip = $('capture-for');
    if (!id) { show(chip, false); return; }
    var name = '';
    if (lib) lib.patients.forEach(function (p) { if (p.id === id) name = p.name; });
    $('capture-for-name').textContent = 'Capturing for ' + name;
    show(chip, true);
  }
  $('patient-capture').addEventListener('click', function () {
    var p = currentPatient();
    if (!p) return;
    setCapturePatient(p.id);
    // Straight into the camera — the input must open inside the tap, since
    // iOS silently drops the camera sheet once the gesture is spent.
    $('photo').click();
  });
  $('patient-pick').addEventListener('click', function () {
    var p = currentPatient();
    if (!p) return;
    setCapturePatient(p.id);
    // The camera page's send-from-library pipeline: multi-select, reviewed
    // one at a time, every POST stamped for this patient.
    $('pick').click();
  });
  $('capture-for-clear').addEventListener('click', function () { setCapturePatient(null); });

  // Re-encode to JPEG capped at 1920px, matching the desktop capture path.
  function shrink(file) {
    return decode(file).then(function (img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('no dimensions');
      var scale = Math.min(1, 1920 / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      if (img.close) img.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode')); }, 'image/jpeg', 0.92);
      });
    });
  }

  function decode(file) {
    if (window.createImageBitmap) {
      // Some engines reject files their own <img> decoder accepts, so a
      // bitmap failure falls back to <img> instead of failing the photo.
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return decodeViaImg(file); });
    }
    // ponytail: pre-2021 iOS Safari has no createImageBitmap; img decode applies EXIF anyway.
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // ---- Library ------------------------------------------------------------
  // ponytail: single in-memory state + rerender on navigation. The manifest
  // refreshes on every Library visit and via the refresh button; edits made
  // on the desktop in between are picked up then.
  var state = { patientId: null, query: '', sort: 'review', sortDir: 'asc' };

  // ---- Patients sort -------------------------------------------------------
  // Default is Review due, soonest first: the urgent patients lead the list
  // (a photo overdue for review is the most urgent thing on it). Key +
  // direction persist per phone so the list opens the way the clinician
  // left it. Choosing a key snaps to its natural direction (names A–Z,
  // soonest review first, most photos, newest capture); the arrow flips it.
  var SORT_KEY = 'camog-sort';
  var SORT_DIR_KEY = 'camog-sort-dir';
  var SORTS = ['recent', 'name', 'review', 'photos'];
  var SORT_DEFAULT_DIR = { recent: 'desc', name: 'asc', review: 'asc', photos: 'desc' };
  try {
    state.sort = localStorage.getItem(SORT_KEY) || 'review';
    state.sortDir = localStorage.getItem(SORT_DIR_KEY) || SORT_DEFAULT_DIR[state.sort] || 'desc';
  } catch (e) { /* private mode */ }
  if (SORTS.indexOf(state.sort) === -1) state.sort = 'review';
  if (state.sortDir !== 'asc' && state.sortDir !== 'desc') {
    state.sortDir = SORT_DEFAULT_DIR[state.sort];
  }
  function persistSort() {
    try {
      localStorage.setItem(SORT_KEY, state.sort);
      localStorage.setItem(SORT_DIR_KEY, state.sortDir);
    } catch (e) { /* private mode */ }
  }
  function syncSortControls() {
    $('sort').value = state.sort;
    var dirBtn = $('sort-dir');
    dirBtn.setAttribute('data-dir', state.sortDir);
    // The arrow names the current order: up = A–Z / soonest first.
    dirBtn.setAttribute(
      'aria-label',
      state.sortDir === 'asc'
        ? 'Sorted ascending. Tap for descending'
        : 'Sorted descending. Tap for ascending',
    );
  }
  syncSortControls();
  $('sort').addEventListener('change', function () {
    state.sort = this.value;
    state.sortDir = SORT_DEFAULT_DIR[state.sort];
    persistSort();
    syncSortControls();
    renderLibrary();
  });
  $('sort-dir').addEventListener('click', function () {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    persistSort();
    syncSortControls();
    renderLibrary();
  });

  function sortedPatients(rows) {
    var byName = function (a, b) { return a.name.localeCompare(b.name); };
    var dir = state.sortDir === 'desc' ? -1 : 1;
    // Each card advertises two review dates: the patient's own schedule and
    // the earliest scheduled photo review. Sort by whichever lands first, so
    // the order matches what the clinician reads on the cards — sorting by
    // the patient's own date alone used to sink patients whose PHOTOS were
    // the urgent ones.
    var nextPhotoDue = {};
    lib.photos.forEach(function (p) {
      if (!p.reviewDueAt) return;
      var cur = nextPhotoDue[p.patientId];
      if (cur === undefined || p.reviewDueAt < cur) nextPhotoDue[p.patientId] = p.reviewDueAt;
    });
    function reviewDue(p) {
      var own = p.reviewDueAt === undefined ? null : p.reviewDueAt;
      var photoDue = nextPhotoDue[p.id];
      if (photoDue === undefined) return own;
      if (own === null) return photoDue;
      return Math.min(own, photoDue);
    }
    // Undated patients sink regardless of direction; dated ties break by name.
    function undatedSink(aKey, bKey, a, b) {
      if (aKey !== null && bKey !== null) return null; // dated: caller sorts
      if (aKey === bKey) return byName(a, b);
      return aKey === null ? 1 : -1;
    }
    if (state.sort === 'name') {
      return rows.slice().sort(function (a, b) { return dir * byName(a, b); });
    }
    if (state.sort === 'review') {
      return rows.slice().sort(function (a, b) {
        var ad = reviewDue(a), bd = reviewDue(b);
        var sink = undatedSink(ad, bd, a, b);
        if (sink !== null) return sink;
        return dir * (ad - bd) || byName(a, b);
      });
    }
    if (state.sort === 'photos') {
      return rows.slice().sort(function (a, b) {
        return dir * (a.photoCount - b.photoCount) || byName(a, b);
      });
    }
    // Recent: last capture, newest first — the order the desktop list ships.
    return rows.slice().sort(function (a, b) {
      var ad = a.lastPhotoAt === undefined ? null : a.lastPhotoAt;
      var bd = b.lastPhotoAt === undefined ? null : b.lastPhotoAt;
      var sink = undatedSink(ad, bd, a, b);
      if (sink !== null) return sink;
      return dir * (ad - bd) || byName(a, b);
    });
  }

  function patientsFor(query) {
    if (!lib) return [];
    var q = query.trim().toLowerCase();
    var rows = lib.patients.filter(function (p) { return p.photoCount > 0 || !q; });
    if (!q) return rows;
    return rows.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
  }

  function photosFor(patientId) {
    if (!lib) return [];
    return lib.photos
      .map(function (p, i) { return { p: p, i: i }; })
      .filter(function (e) { return e.p.patientId === patientId; })
      .sort(function (a, b) { return b.p.capturedAt - a.p.capturedAt; });
  }

  // Patient-card flags, desktop patient-card parity. Line 1 is the patient's
  // own review schedule (the desktop ReviewBadge): the date shows however far
  // out it sits — amber only inside the warning window, which the desktop
  // already resolved into reviewOwn for us. Line 2 is the photo-level due
  // badge (the desktop PhotoReviewDueBadge): "N photos due for review … · M
  // overdue", or a quiet "Next photo review on …" for dates months away.
  // `due` is that patient's photo summary from dueSummary(p.id).
  function flagHtml(p, due) {
    var flags = [];
    var own = p.reviewOwn || p.review; // manifests predating reviewOwn
    if (own === 'overdue') {
      flags.push('<div class="flag flag-overdue">Review overdue' +
        (p.reviewDueAt ? ' \u00b7 was due ' + fmtDate(p.reviewDueAt) : '') + '</div>');
    } else if (own === 'due-soon') {
      flags.push('<div class="flag flag-warn">Review due' +
        (p.reviewDueAt ? ' ' + fmtDate(p.reviewDueAt) : '') + '</div>');
    } else if (own === 'scheduled' && p.reviewDueAt) {
      flags.push('<div class="flag flag-quiet">Review ' + fmtDate(p.reviewDueAt) + '</div>');
    } else if (own === 'stale') {
      flags.push('<div class="flag flag-quiet">Not reviewed lately</div>');
    }
    if (due.due > 0) {
      flags.push('<div class="flag ' + (due.overdue ? 'flag-overdue' : 'flag-warn') + '">' +
        due.due + (due.due === 1 ? ' photo' : ' photos') + ' due for review' +
        (due.nextDueAt !== null ? ' on ' + fmtDate(due.nextDueAt) : '') +
        (due.overdue ? ' \u00b7 ' + due.overdue + ' overdue' : '') + '</div>');
    } else if (due.nextDueAt !== null) {
      flags.push('<div class="flag flag-quiet">Next photo review on ' + fmtDate(due.nextDueAt) + '</div>');
    }
    if (p.consent === 'expired') flags.push('<div class="flag flag-warn">Consent expired</div>');
    else if (p.consent === 'none') flags.push('<div class="flag flag-warn">No consent on record</div>');
    return flags.join('');
  }

  // Photo-grid review flag: a corner dot on cells that need review, and the
  // aria-label fragment that says so.
  function reviewDot(p) {
    if (p.review !== 'overdue' && p.review !== 'due-soon') return null;
    var dot = document.createElement('span');
    dot.className = 'cell-review ' + p.review;
    return dot;
  }

  function reviewAria(p) {
    if (p.review === 'overdue') return ', review overdue';
    if (p.review === 'due-soon') return ', review due soon';
    return '';
  }

  // ---- Due-review banner (desktop patients-page parity) --------------------
  // The numbers the desktop's review badge shows: photos due (overdue +
  // inside the warning window), how many are overdue, and the earliest
  // scheduled date — across the whole shared library for the tab banners, or
  // one patient's photos for the patient card's due line (with patientId).
  var ICON_ALARM =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/></svg>';
  var ICON_CAL =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>';

  function dueSummary(patientId) {
    var due = 0, overdue = 0, nextDueAt = null;
    (lib ? lib.photos : []).forEach(function (p) {
      if (patientId && p.patientId !== patientId) return;
      if (!p.reviewDueAt) return;
      if (nextDueAt === null || p.reviewDueAt < nextDueAt) nextDueAt = p.reviewDueAt;
      if (p.review === 'overdue') { due += 1; overdue += 1; }
      else if (p.review === 'due-soon') due += 1;
    });
    return { due: due, overdue: overdue, nextDueAt: nextDueAt };
  }

  function renderDueBanner(el) {
    var s = dueSummary();
    if (!s.due && s.nextDueAt === null) { show(el, false); return; }
    var text = s.due > 0
      ? s.due + (s.due === 1 ? ' photo' : ' photos') + ' due for review' +
        (s.nextDueAt !== null ? ' on ' + fmtDate(s.nextDueAt) : '') +
        (s.overdue ? ' \u00b7 ' + s.overdue + ' overdue' : '')
      : 'Next photo review' + (s.nextDueAt !== null ? ' on ' + fmtDate(s.nextDueAt) : '');
    el.className = 'due-banner ' + (s.overdue ? 'overdue' : s.due ? 'due' : 'quiet');
    el.innerHTML = (s.due > 0 ? ICON_ALARM : ICON_CAL) + '<span></span>';
    el.lastChild.textContent = text;
    show(el, true);
  }

  function renderLibrary() {
    if (!lib) return;
    var rows = sortedPatients(patientsFor(state.query));
    var host = $('patients');
    host.innerHTML = '';
    rows.forEach(function (p) {
      var meta = p.photoCount + (p.photoCount === 1 ? ' photo' : ' photos');
      if (p.lastPhotoAt) meta += ' \u00b7 last ' + fmtDate(p.lastPhotoAt);
      var flags = flagHtml(p, dueSummary(p.id));
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'patient-row';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML =
        '<span class="grow"><span class="name"></span>' +
        '<div class="meta"></div>' + flags + '</span>' +
        '<svg class="chev" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      btn.querySelector('.name').textContent = p.name;
      btn.querySelector('.meta').textContent = meta;
      btn.addEventListener('click', function () { openPatient(p.id); });
      host.appendChild(btn);
    });
    show($('lib-empty'), rows.length === 0);
    show($('search'), lib.patients.length > 0);
    renderDueBanner($('lib-due'));
  }

  $('search').addEventListener('input', function () {
    state.query = this.value;
    renderLibrary();
  });

  $('refresh').addEventListener('click', function () {
    fetchLibrary().then(function () { renderLibrary(); }).catch(function () {
      fail('Could not refresh the library. Is Camog still open?');
    });
  });

  function currentPatient() {
    if (!lib || !state.patientId) return null;
    var found = null;
    lib.patients.forEach(function (x) { if (x.id === state.patientId) found = x; });
    return found;
  }

  // Desktop-parity detail lines under the photo count.
  function detailLines(p) {
    var lines = [];
    if (p.dob) lines.push('DOB ' + p.dob);
    if (p.ownerName) lines.push('Treating clinician: ' + p.ownerName);
    if (p.consentScopeLabel && p.consent !== 'none') {
      lines.push('Consent: ' + p.consentScopeLabel);
    }
    return lines;
  }

  function openPatient(patientId) {
    if (!lib) return;
    state.patientId = patientId;
    var p = currentPatient();
    if (!p) return;
    $('patient-name').textContent = p.name;
    $('patient-meta').textContent = p.photoCount + (p.photoCount === 1 ? ' photo' : ' photos');
    var detail = $('patient-detail');
    detail.innerHTML = '';
    detailLines(p).forEach(function (line) {
      var el = document.createElement('div');
      el.textContent = line;
      detail.appendChild(el);
    });
    $('patient-status').textContent = '';
    $('patient-status').className = '';
    renderGrid();
    setTab('lib');
    history.pushState({ view: 'patient' }, '');
  }

  function renderGrid() {
    var grid = $('grid');
    grid.innerHTML = '';
    var list = photosFor(state.patientId);
    list.forEach(function (e) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute('aria-label', e.p.bodyPartLabel + ', ' + fmtDate(e.p.capturedAt) + reviewAria(e.p));
      var img = document.createElement('img');
      img.src = 'img/' + e.p.id + '.thumb.jpg';
      img.alt = '';
      img.loading = 'lazy';
      cell.appendChild(img);
      // Body-map indicator: where on the patient this was taken.
      var fig = bodyFigure(e.p.bodyPart, e.p.laterality);
      fig.classList.add('cell-fig');
      cell.appendChild(fig);
      var dot = reviewDot(e.p);
      if (dot) cell.appendChild(dot);
      cell.addEventListener('click', function () { openViewer(list, e.i, false); });
      grid.appendChild(cell);
    });
    updateCompareButton();
  }

  $('back').addEventListener('click', function () { history.back(); });

  function closePatient() {
    state.patientId = null;
    if (lib) setTab('lib');
  }

  // ---- Case report (desktop does the work) --------------------------------
  function postPatientRequest(path, patientId) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: patientId }),
    }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
    });
  }

  // ---- Photo review (desktop-dialog parity) --------------------------------
  // The viewer's Mark reviewed asks the desktop dialog's question: stamp the
  // review, and optionally snap the follow-up photo right here. The snap is
  // linked into the reviewed photo's lesion series when it is saved on the
  // computer — the desktop arms that link when the request carries snap.
  function postPhotoReview(photoId, snap) {
    return fetch('photo-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: photoId, snap: snap }),
    }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
    });
  }

  // Banner pieces only (status chip + last-reviewed line). Unlike
  // renderViewerReview it leaves the three-choice offer exactly as it is —
  // a dismissed camera or picker must not dump the user back to
  // "Mark reviewed" and make them round-trip just to retry.
  function renderViewerBanner(p) {
    var flag = $('viewer-flag');
    var labels = {
      overdue: 'Review overdue',
      'due-soon': 'Review due soon',
      scheduled: 'Review ' + (p.reviewDueAt ? fmtDate(p.reviewDueAt) : ''),
      stale: 'Not reviewed lately',
    };
    if (labels[p.review]) {
      flag.textContent = labels[p.review];
      flag.className = p.review;
      show(flag, true);
    } else {
      show(flag, false);
    }
    var last = $('viewer-last');
    if (p.lastReviewedAt) {
      last.textContent = 'Reviewed ' + fmtDate(p.lastReviewedAt);
      show(last, true);
    } else {
      show(last, false);
    }
  }

  function renderViewerReview(p) {
    renderViewerBanner(p);
    // A freshly rendered photo always starts from the one-click button.
    show($('viewer-offer'), false);
    show($('viewer-offer-hint'), false);
    show($('viewer-review-btn'), true);
    $('photo-review-snap').disabled = false;
    $('photo-review-library').disabled = false;
    $('photo-review-plain').disabled = false;
    var status = $('viewer-review-status');
    status.className = '';
    status.textContent = '';
    show(status, false);
  }

  $('viewer-review-btn').addEventListener('click', function () {
    if (!currentEntry()) return;
    show($('viewer-review-btn'), false);
    show($('viewer-offer'), true);
    show($('viewer-offer-hint'), true);
  });

  function hideViewerOffer() {
    show($('viewer-offer'), false);
    show($('viewer-offer-hint'), false);
    show($('viewer-review-btn'), true);
    $('photo-review-snap').disabled = false;
    $('photo-review-plain').disabled = false;
  }

  // `viaLibrary` sends the follow-up from the phone's photo library instead
  // of the camera; both ride the same armed series link.
  function markPhotoReviewed(snap, viaLibrary) {
    var e = currentEntry();
    if (!e) return;
    $('photo-review-snap').disabled = true;
    $('photo-review-library').disabled = true;
    $('photo-review-plain').disabled = true;
    var status = $('viewer-review-status');
    status.className = '';
    status.textContent = 'Marking reviewed on your computer\u2026';
    show(status, true);
    if (snap) {
      // Open the camera or the library picker inside the tap: iOS honours
      // neither without a live user gesture, so the review POST runs
      // alongside — the desktop arms the series link the moment the
      // request lands, long before the follow-up is sent. The follow-up
      // (taken or picked) flows down the normal review-and-send path with
      // the note set; if the stamp fails, it still sends, just unlinked,
      // and the error says to re-mark.
      $(viaLibrary ? 'pick' : 'photo').click();
      postPhotoReview(e.p.id, true).then(function () {
        snapFollowUp = true;
        setConn('Review marked. Send this photo to link it with the original.');
        return fetchLibrary().catch(function () {}).then(function () {
          if (lib) lib.photos.forEach(function (p) { if (p.id === e.p.id) e.p = p; });
          // Stay on the three-choice offer with the banner flipped in
          // place: a dismissed camera or picker (or one still open while
          // this answers) leaves the buttons live, so retrying never
          // round-trips through "Mark reviewed" again.
          if (viewerOpen()) {
            renderViewerBanner(e.p);
            show(status, false);
            $('photo-review-snap').disabled = false;
            $('photo-review-library').disabled = false;
            $('photo-review-plain').disabled = false;
          }
        });
      }).catch(function () {
        snapFollowUp = false;
        fail('Camog could not stamp the review \u2014 send the photo, then mark it reviewed again on the computer.');
      });
      return;
    }
    postPhotoReview(e.p.id, false).then(function () {
      // The desktop stamps the review and republishes the manifest; pick it
      // up so the banner flips without leaving the photo.
      return fetchLibrary().catch(function () {}).then(function () {
        if (lib) lib.photos.forEach(function (p) { if (p.id === e.p.id) e.p = p; });
        renderViewerReview(e.p);
      });
    }).catch(function () {
      status.className = 'err';
      status.textContent = 'Could not reach Camog. Try again.';
      $('photo-review-snap').disabled = false;
      $('photo-review-library').disabled = false;
      $('photo-review-plain').disabled = false;
    });
  }

  $('photo-review-snap').addEventListener('click', function () { markPhotoReviewed(true, false); });
  $('photo-review-library').addEventListener('click', function () { markPhotoReviewed(true, true); });
  $('photo-review-plain').addEventListener('click', function () { markPhotoReviewed(false); });

  // Deliver the staged report. A browser tab can open the PDF directly, but
  // a standalone home-screen app can neither spawn a tab (target="_blank" is
  // a silent no-op there) nor render PDFs inline — so in that mode hand the
  // bytes to the platform instead: the share sheet where it exists (iOS,
  // also covering standalone), else a plain download (Android).
  function downloadReport(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'camog-case-report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function openReport() {
    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (!standalone) {
      var a = document.createElement('a');
      a.href = 'report';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return Promise.resolve();
    }
    return fetch('report').then(function (res) {
      if (!res.ok) throw new Error('not ready');
      return res.blob();
    }).then(function (blob) {
      var file = null;
      try {
        file = new File([blob], 'camog-case-report.pdf', { type: 'application/pdf' });
      } catch (e) { /* pre-2020 engines: no File constructor */ }
      if (!(file && navigator.share && navigator.canShare &&
            navigator.canShare({ files: [file] }))) {
        downloadReport(blob);
        return;
      }
      return navigator.share({ files: [file], title: 'Case report' }).catch(function (err) {
        if (err && err.name === 'AbortError') return; // user dismissed the sheet
        // Share can fail transiently (e.g. the tap's user-activation expired
        // while the report was still being prepared) — deliver the download
        // instead of failing.
        downloadReport(blob);
      });
    });
  }

  var reportTimer = null;
  $('report-btn').addEventListener('click', function () {
    var p = currentPatient();
    if (!p) return;
    var btn = $('report-btn');
    var status = $('patient-status');
    btn.disabled = true;
    status.className = '';
    status.textContent = 'Preparing the report on your computer\u2026';
    var tries = 0;
    postPatientRequest('report-request', p.id).then(function () {
      return new Promise(function (resolve, reject) {
        reportTimer = setInterval(function () {
          tries += 1;
          if (tries > 20) {
            clearInterval(reportTimer);
            reject(new Error('timeout'));
            return;
          }
          fetch('report').then(function (res) {
            if (res.ok) {
              clearInterval(reportTimer);
              resolve();
            }
          }).catch(function () { /* keep polling */ });
        }, 1500);
      });
    }).then(function () {
      status.className = 'ok';
      status.textContent = 'Report ready.';
      btn.disabled = false;
      return openReport();
    }).catch(function () {
      status.className = 'err';
      status.textContent = 'Could not prepare the report. Try again.';
      btn.disabled = false;
    });
  });

  // ---- All photos (mirrors the desktop Photos page) ------------------------
  var allQuery = '';

  function patientName(id) {
    var name = '';
    if (lib) lib.patients.forEach(function (x) { if (x.id === id) name = x.name; });
    return name;
  }

  function allPhotos() {
    if (!lib) return [];
    return lib.photos
      .map(function (p, i) { return { p: p, i: i }; })
      .sort(function (a, b) { return b.p.capturedAt - a.p.capturedAt; });
  }

  function photosMatching(entries, query) {
    var q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(function (e) {
      return patientName(e.p.patientId).toLowerCase().indexOf(q) !== -1 ||
        e.p.bodyPartLabel.toLowerCase().indexOf(q) !== -1 ||
        (e.p.subpart || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderAll() {
    if (!lib) return;
    var entries = photosMatching(allPhotos(), allQuery);
    var grid = $('all-grid');
    grid.innerHTML = '';
    entries.forEach(function (e) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute(
        'aria-label',
        patientName(e.p.patientId) + ' \u2014 ' + e.p.bodyPartLabel + ', ' + fmtDate(e.p.capturedAt) + reviewAria(e.p),
      );
      var img = document.createElement('img');
      img.src = 'img/' + e.p.id + '.thumb.jpg';
      img.alt = '';
      img.loading = 'lazy';
      cell.appendChild(img);
      // Name chip: rows mix patients, so each photo says whose it is.
      var name = document.createElement('span');
      name.className = 'cell-name';
      name.textContent = patientName(e.p.patientId);
      cell.appendChild(name);
      var fig = bodyFigure(e.p.bodyPart, e.p.laterality);
      fig.classList.add('cell-fig');
      cell.appendChild(fig);
      var dot = reviewDot(e.p);
      if (dot) cell.appendChild(dot);
      cell.addEventListener('click', function () { openViewer(entries, e.i, true); });
      grid.appendChild(cell);
    });
    show($('all-empty'), entries.length === 0);
    show($('all-search'), lib.photos.length > 0);
    renderDueBanner($('all-due'));
  }

  $('all-search').addEventListener('input', function () {
    allQuery = this.value;
    renderAll();
  });

  $('all-refresh').addEventListener('click', function () {
    fetchLibrary().then(function () { renderAll(); }).catch(function () {
      fail('Could not refresh the photos. Is Camog still open?');
    });
  });

  // ---- Compare (mirrors the desktop dialog) --------------------------------
  // Two pickers (Earlier / reference, Later / current), side-by-side or
  // overlay mode with an opacity slider, and an anchor toggle: linked (the
  // default) one pan/zoom moves both photos in lockstep; free, each pane
  // moves on its own until the anchor is re-engaged.
  function viewerOpen() { return !$('screen-viewer').hidden; }
  function compareOpen() { return !$('screen-compare').hidden; }

  // Per-pane viewport: zoom + pan for the left and right photo. The anchor
  // toggle links them (the default) or lets each move freely.
  function cmpView() { return { zoom: 1, ox: 0, oy: 0 }; }

  var cmp = {
    photos: [], leftId: null, rightId: null,
    mode: 'side', opacity: 50,
    anchored: true, active: 'left',
    left: cmpView(), right: cmpView(),
    drag: null, pinch: null,
    poll: null,
  };

  function fmtDateTime(ms) {
    var d = new Date(ms);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return fmtDate(ms) + ', ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function cmpLabel(entry) {
    return fmtDate(entry.p.capturedAt) + ' \u00b7 ' + entry.p.bodyPartLabel +
      (entry.p.subpart ? ' \u00b7 ' + entry.p.subpart : '');
  }

  function cmpEntry(id) {
    var found = null;
    cmp.photos.forEach(function (e) { if (e.i === id) found = e; });
    return found;
  }

  function updateCompareButton() {
    $('compare-btn').disabled = photosFor(state.patientId).length < 2;
    $('compare-label').textContent = 'Compare';
  }

  function buildPickers() {
    [['cmp-left', 'left'], ['cmp-right', 'right']].forEach(function (pair) {
      var select = $(pair[0]);
      select.innerHTML = '';
      cmp.photos.forEach(function (e) {
        var opt = document.createElement('option');
        opt.value = String(e.i);
        opt.textContent = cmpLabel(e);
        select.appendChild(opt);
      });
      select.onchange = function () {
        cmp[pair[1] + 'Id'] = Number(select.value);
        // A new photo resets the viewport to default, like the desktop.
        cmp.left = cmpView();
        cmp.right = cmpView();
        cmp.active = 'left';
        renderCompare();
      };
    });
  }

  function openCompare() {
    cmp.photos = photosFor(state.patientId);
    if (cmp.photos.length < 2) return;
    // Desktop default: newest first; left = the newest, right = the next.
    var sorted = cmp.photos.slice().sort(function (a, b) {
      return b.p.capturedAt - a.p.capturedAt;
    });
    cmp.leftId = sorted[0].i;
    cmp.rightId = sorted[1].i;
    cmp.mode = 'side';
    cmp.opacity = 50;
    cmp.anchored = true;
    cmp.active = 'left';
    cmp.left = cmpView();
    cmp.right = cmpView();
    buildPickers();
    syncAnchorButton();
    renderCompare();
    show($('screen-compare'), true);
    updateChrome();
    history.pushState({ view: 'compare' }, '');
  }

  function cmpPane(entry, side) {
    var pane = document.createElement('div');
    pane.className = 'cmp-pane';
    pane.dataset.side = side;
    var img = document.createElement('img');
    img.dataset.side = side;
    img.src = 'img/' + entry.p.id + '.jpg';
    img.alt = 'Photo from ' + fmtDate(entry.p.capturedAt);
    img.draggable = false;
    pane.appendChild(img);
    var chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = fmtDateTime(entry.p.capturedAt);
    pane.appendChild(chip);
    return pane;
  }

  function renderCompare() {
    $('cmp-left').value = String(cmp.leftId);
    $('cmp-right').value = String(cmp.rightId);
    $('mode-side').setAttribute('aria-pressed', cmp.mode === 'side' ? 'true' : 'false');
    $('mode-overlay').setAttribute('aria-pressed', cmp.mode === 'overlay' ? 'true' : 'false');
    show($('cmp-opacity-row'), cmp.mode === 'overlay');
    $('cmp-opacity').value = String(cmp.opacity);

    var frame = $('cmp-frame');
    frame.innerHTML = '';
    var left = cmpEntry(cmp.leftId);
    var right = cmpEntry(cmp.rightId);
    if (cmp.mode === 'side') {
      var grid = document.createElement('div');
      grid.className = 'cmp-grid';
      if (left) grid.appendChild(cmpPane(left, 'left'));
      if (right) grid.appendChild(cmpPane(right, 'right'));
      frame.appendChild(grid);
    } else {
      var overlay = document.createElement('div');
      overlay.className = 'cmp-overlay';
      [left, right].forEach(function (entry, idx) {
        if (!entry) return;
        var img = document.createElement('img');
        img.src = 'img/' + entry.p.id + '.jpg';
        img.alt = '';
        img.draggable = false;
        img.dataset.side = idx === 0 ? 'left' : 'right';
        img.style.opacity = idx === 0 ? '1' : String(cmp.opacity / 100);
        overlay.appendChild(img);
      });
      var chip = document.createElement('span');
      chip.className = 'chip';
      if (left && right) {
        chip.textContent = fmtDate(left.p.capturedAt) + ' \u2192 ' + fmtDate(right.p.capturedAt) + ' (' + cmp.opacity + '%)';
      }
      overlay.appendChild(chip);
      frame.appendChild(overlay);
    }
    cmpApplyTransform();
  }

  function cmpClampZoom(z) { return Math.min(8, Math.max(1, z)); }

  // Anchor semantics (mirrors the desktop viewer): an anchored gesture moves
  // both panes by the same delta / factor from each pane's own state, so
  // re-anchoring after free movement keeps each photo's framing and the next
  // gesture moves them together from there. A free gesture moves only the
  // pane under the finger.
  function cmpPanBy(start, dx, dy, anchored, side) {
    function pan(v) { return { zoom: v.zoom, ox: v.ox + dx, oy: v.oy + dy }; }
    if (anchored) { cmp.left = pan(start.left); cmp.right = pan(start.right); }
    else { cmp[side] = pan(start[side]); }
  }

  function cmpZoomOn(start, factor, anchored, side) {
    function zoom(v) { return { zoom: cmpClampZoom(v.zoom * factor), ox: v.ox, oy: v.oy }; }
    if (anchored) { cmp.left = zoom(start.left); cmp.right = zoom(start.right); }
    else { cmp[side] = zoom(start[side]); }
  }

  function cmpSnapshot() {
    return {
      left: { zoom: cmp.left.zoom, ox: cmp.left.ox, oy: cmp.left.oy },
      right: { zoom: cmp.right.zoom, ox: cmp.right.ox, oy: cmp.right.oy },
    };
  }

  function syncAnchorButton() {
    var btn = $('cmp-anchor');
    btn.setAttribute('aria-pressed', cmp.anchored ? 'true' : 'false');
    btn.setAttribute('aria-label', cmp.anchored ? 'Anchor panes together' : 'Panes move freely');
    $('cmp-anchor-label').textContent = cmp.anchored ? 'Linked' : 'Free';
  }

  function cmpApplyTransform() {
    var imgs = document.querySelectorAll('#cmp-frame img');
    Array.prototype.forEach.call(imgs, function (img) {
      var v = img.dataset.side === 'right' ? cmp.right : cmp.left;
      img.style.transform = 'translate(' + v.ox + 'px,' + v.oy + 'px) scale(' + v.zoom + ')';
    });
    $('zoom-pct').textContent = Math.round(cmp[cmp.active].zoom * 100) + '%';
  }

  $('zoom-in').addEventListener('click', function () {
    cmpZoomOn(cmpSnapshot(), 1.25, cmp.anchored, cmp.active);
    cmpApplyTransform();
  });
  $('zoom-out').addEventListener('click', function () {
    cmpZoomOn(cmpSnapshot(), 0.8, cmp.anchored, cmp.active);
    cmpApplyTransform();
  });
  $('zoom-reset').addEventListener('click', function () {
    cmp.left = cmpView();
    cmp.right = cmpView();
    cmpApplyTransform();
  });
  $('cmp-anchor').addEventListener('click', function () {
    cmp.anchored = !cmp.anchored;
    syncAnchorButton();
  });
  $('mode-side').addEventListener('click', function () { cmp.mode = 'side'; renderCompare(); });
  $('mode-overlay').addEventListener('click', function () { cmp.mode = 'overlay'; renderCompare(); });
  $('cmp-opacity').addEventListener('input', function () {
    cmp.opacity = Number(this.value);
    renderCompare();
  });
  $('compare-btn').addEventListener('click', function () { openCompare(); });
  $('compare-back').addEventListener('click', function () { history.back(); });

  // Pan (one finger) and pinch zoom (two fingers) on the compare frame.
  // Anchored (the default) every image moves together, like the desktop's
  // shared viewport; with the anchor off only the touched pane moves.
  (function () {
    var frame = $('cmp-frame');
    function touchDist(ev) {
      var dx = ev.touches[0].clientX - ev.touches[1].clientX;
      var dy = ev.touches[0].clientY - ev.touches[1].clientY;
      return Math.max(1, Math.sqrt(dx * dx + dy * dy));
    }
    function touchSide(ev) {
      var pane = ev.target && ev.target.closest ? ev.target.closest('.cmp-pane') : null;
      if (pane) return pane.dataset.side === 'right' ? 'right' : 'left';
      return cmp.active; // overlay has no panes; keep the last-touched side
    }
    frame.addEventListener('touchstart', function (ev) {
      var side = touchSide(ev);
      cmp.active = side;
      if (ev.touches.length === 1) {
        cmp.drag = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, start: cmpSnapshot(), side: side };
      } else if (ev.touches.length >= 2) {
        cmp.drag = null;
        cmp.pinch = { dist: touchDist(ev), start: cmpSnapshot(), side: side };
      }
    }, { passive: true });
    frame.addEventListener('touchmove', function (ev) {
      if (cmp.pinch && ev.touches.length >= 2) {
        ev.preventDefault();
        cmpZoomOn(cmp.pinch.start, touchDist(ev) / cmp.pinch.dist, cmp.anchored, cmp.pinch.side);
        cmpApplyTransform();
      } else if (cmp.drag && ev.touches.length === 1) {
        ev.preventDefault();
        cmpPanBy(
          cmp.drag.start,
          ev.touches[0].clientX - cmp.drag.x,
          ev.touches[0].clientY - cmp.drag.y,
          cmp.anchored, cmp.drag.side,
        );
        cmpApplyTransform();
      }
    }, { passive: false });
    frame.addEventListener('touchend', function (ev) {
      if (ev.touches.length === 0) {
        cmp.drag = null;
        cmp.pinch = null;
      } else if (ev.touches.length === 1) {
        cmp.pinch = null;
        var side = touchSide(ev);
        cmp.active = side;
        cmp.drag = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, start: cmpSnapshot(), side: side };
      }
    }, { passive: true });
  })();

  function closeCompare() {
    show($('screen-compare'), false);
    updateChrome();
  }

  // ---- Viewer -------------------------------------------------------------
  var viewer = { photos: [], idx: 0, names: false, touchX: null, lastTap: 0 };

  /** The photo entry currently open in the viewer, or null. */
  function currentEntry() { return viewer.photos[viewer.idx] || null; }

  // `list` is the calling grid's own photo list (one patient's, or the whole
  // library); `id` is the photo's index in the shared manifest and is resolved
  // by id, never by position, so the tap opens the photo the user saw.
  // `names` prefixes the patient's name when the list mixes patients.
  function openViewer(list, id, names) {
    viewer.photos = list;
    viewer.names = !!names;
    var idx = -1;
    viewer.photos.forEach(function (x, k) { if (x.i === id) idx = k; });
    if (idx < 0) return;
    viewer.idx = idx;
    renderViewer();
    show($('screen-viewer'), true);
    updateChrome();
    history.pushState({ view: 'viewer' }, '');
  }

  function renderViewer() {
    var e = viewer.photos[viewer.idx];
    if (!e) return;
    var img = $('viewer-img');
    $('stage').classList.remove('zoomed');
    img.src = 'img/' + e.p.id + '.jpg';
    img.alt = e.p.bodyPartLabel + ' photo';
    // Preload neighbours so swiping feels instant.
    [viewer.idx - 1, viewer.idx + 1].forEach(function (i) {
      var n = viewer.photos[i];
      if (n) { var pre = new Image(); pre.src = 'img/' + n.p.id + '.jpg'; }
    });
    $('viewer-count').textContent = (viewer.idx + 1) + ' of ' + viewer.photos.length;
    $('viewer-title').textContent =
      (viewer.names ? patientName(e.p.patientId) + ' \u00b7 ' : '') +
      e.p.bodyPartLabel + (e.p.subpart ? ' \u00b7 ' + e.p.subpart : '');
    $('viewer-date').textContent = 'Taken ' + fmtDate(e.p.capturedAt);
    var notes = $('viewer-notes');
    if (e.p.notes) {
      notes.textContent = e.p.notes;
      show(notes, true);
    } else {
      show(notes, false);
    }
    renderViewerReview(e.p);
  }

  function closeViewer() {
    show($('screen-viewer'), false);
    updateChrome();
  }

  $('viewer-back').addEventListener('click', function () { history.back(); });

  // Blur for privacy when showing photos with others nearby.
  $('blur-btn').addEventListener('click', function () {
    var stage = $('stage');
    var on = stage.classList.toggle('blurred');
    this.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // Swipe to navigate; double-tap toggles a 2.4x zoom centred on the tap.
  $('stage').addEventListener('touchstart', function (ev) {
    viewer.touchX = ev.touches[0].clientX;
  }, { passive: true });
  $('stage').addEventListener('touchend', function (ev) {
    if (viewer.touchX == null) return;
    var dx = ev.changedTouches[0].clientX - viewer.touchX;
    viewer.touchX = null;
    if (Math.abs(dx) > 48) {
      var next = viewer.idx + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < viewer.photos.length) {
        viewer.idx = next;
        renderViewer();
      }
      return;
    }
    var now = Date.now();
    var stage = $('stage');
    if (now - viewer.lastTap < 320) {
      if (stage.classList.contains('zoomed')) {
        stage.classList.remove('zoomed');
      } else {
        var r = stage.getBoundingClientRect();
        var t = ev.changedTouches[0];
        stage.style.transformOrigin =
          ((t.clientX - r.left) / r.width * 100) + '% ' + ((t.clientY - r.top) / r.height * 100) + '%';
        stage.classList.add('zoomed');
      }
      viewer.lastTap = 0;
    } else {
      viewer.lastTap = now;
    }
  }, { passive: true });

  // Arrow keys for accessibility (e.g. tablets with keyboards).
  addEventListener('keydown', function (ev) {
    if ($('screen-viewer').hidden) return;
    if (ev.key === 'ArrowRight' && viewer.idx < viewer.photos.length - 1) { viewer.idx++; renderViewer(); }
    if (ev.key === 'ArrowLeft' && viewer.idx > 0) { viewer.idx--; renderViewer(); }
    if (ev.key === 'Escape') history.back();
  });

  // Hardware/gesture back walks viewer -> compare -> patient -> library.
  addEventListener('popstate', function () {
    if (viewerOpen()) {
      closeViewer();
    } else if (compareOpen()) {
      closeCompare();
    } else if (state.patientId) {
      closePatient();
    }
  });
})();
</script>
</body>
</html>
"##;

// The link page: served to any phone the auth gate rejects. A session that
// died with a desktop restart is healed silently by the companion page (the
// saved pairing URL re-mints it), but a rotated or lost link used to
// dead-end on a bare 404 with nothing to do but leave and re-scan from the
// camera app. This page is the way back in: restore the saved link with one
// tap, or scan the desktop's QR from here. Static and secret-free — the
// pairing code only ever arrives through the phone's own action — so it is
// safe to hand to unauthenticated requests.
const LINK_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f4f4f5" id="meta-theme">
<title>Camog &middot; Link</title>
<style>
  /* Same tokens as the companion page; follows the appearance the phone
     last chose there (the two pages share this origin's storage). */
  :root {
    color-scheme: dark;
    --bg: #0a0a0a;
    --card: #171717;
    --fg: #fafafa;
    --muted: #a1a1aa;
    --border: rgba(255, 255, 255, 0.1);
    --primary: #00aeb5;
    --primary-fg: #001011;
    --error: #f87171;
    --radius: 10px;
  }
  body.theme-dark { color-scheme: dark; }
  body.light {
    color-scheme: light;
    --bg: #f4f4f5;
    --card: #ffffff;
    --fg: #18181b;
    --muted: #52525b;
    --border: rgba(0, 0, 0, 0.1);
    --primary: #007b82;
    --primary-fg: #ffffff;
    --error: #dc2626;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--fg);
    -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; touch-action: manipulation; }
  button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  [hidden] { display: none !important; }
  main {
    min-height: 100dvh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 14px; padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  }
  header { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  header img {
    width: 56px; height: 56px; padding: 6px;
    border-radius: 14px; border: 1px solid var(--border);
    background: var(--card); object-fit: contain;
  }
  .wordmark { font-size: 20px; font-weight: 600; line-height: 1.2; }
  .tagline { font-size: 13px; color: var(--muted); }
  p { font-size: 15px; line-height: 1.5; color: var(--muted); margin: 0; text-align: center; max-width: 34ch; }
  .btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; max-width: 340px; min-height: 48px; padding: 13px 16px; border-radius: var(--radius);
    font-size: 17px; font-weight: 600; text-align: center;
    -webkit-user-select: none; user-select: none;
  }
  .btn-primary { background: var(--primary); color: var(--primary-fg); }
  .btn-secondary { background: var(--card); color: var(--fg); border: 1px solid var(--border); }
  .btn svg { width: 18px; height: 18px; flex: none; }
  #scanbox { width: 100%; max-width: 340px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
  #scanbox video { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
  #err { color: var(--error); }
</style>
</head>
<body class="light">
  <main>
    <header>
      <img src="logo.png" alt="Camog">
      <div>
        <div class="wordmark">Camog</div>
        <div class="tagline">Phone link</div>
      </div>
    </header>
    <p id="hint">Scan the QR code shown in Camog on your computer to link this phone.</p>
    <button type="button" class="btn btn-primary" id="scan" hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>
      Scan QR code
    </button>
    <div id="scanbox" hidden><video id="video" autoplay playsinline muted></video></div>
    <button type="button" class="btn btn-secondary" id="restore" hidden>Restore saved link</button>
    <p id="err"></p>
  </main>
<script>
(function () {
  'use strict';
  var LINK_KEY = 'camog-link-code';
  var TRIED_KEY = 'camog-link-tried';

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.hidden = !on; }
  function fail(msg) { $('err').textContent = msg || ''; }

  try {
    if (localStorage.getItem('camog-theme') === 'dark') {
      document.body.classList.remove('light');
      document.body.classList.add('theme-dark');
      $('meta-theme').setAttribute('content', '#0a0a0a');
    }
  } catch (e) { /* private mode */ }

  function go(code) {
    code = String(code || '').trim().toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(code)) {
      fail('That QR is not a Camog link.');
      return;
    }
    try {
      localStorage.setItem(LINK_KEY, code);
      sessionStorage.setItem(TRIED_KEY, '1');
    } catch (e) { /* private mode */ }
    location.href = '/t/' + code + '/';
  }

  // Restore: the code this phone last linked with. Tried once on load so a
  // dead session heals itself; the tried-flag keeps a rotated code from
  // ping-ponging (the companion page clears it once a link is live again).
  var saved = null;
  try { saved = localStorage.getItem(LINK_KEY); } catch (e) {}
  if (saved) {
    show($('restore'), true);
    $('restore').addEventListener('click', function () { go(saved); });
    var tried = null;
    try { tried = sessionStorage.getItem(TRIED_KEY); } catch (e) {}
    if (!tried) go(saved);
  }

  // In-page QR scan where the engine can read codes itself (Android today;
  // iOS Safari has no BarcodeDetector, so there the button stays hidden and
  // the camera app does the scanning).
  // ponytail: no bundled QR decoder — embed one (e.g. jsQR) only if in-page
  // scanning on iOS is ever demanded.
  if (window.BarcodeDetector && navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia) {
    show($('scan'), true);
    $('scan').addEventListener('click', function () {
      var detector = new BarcodeDetector({ formats: ['qr_code'] });
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function (stream) {
          var video = $('video');
          var timer = null;
          var stop = function () {
            if (timer) clearInterval(timer);
            stream.getTracks().forEach(function (t) { t.stop(); });
          };
          addEventListener('pagehide', stop);
          video.srcObject = stream;
          show($('scanbox'), true);
          return video.play().then(function () {
            timer = setInterval(function () {
              detector.detect(video).then(function (found) {
                for (var i = 0; i < found.length; i++) {
                  var m = /\/t\/([0-9a-fA-F]{16})\//.exec(found[i].rawValue || '');
                  if (m) { stop(); go(m[1]); return; }
                }
              }).catch(function () { /* frame not ready */ });
            }, 300);
          });
        })
        .catch(function () {
          show($('scanbox'), false);
          fail('Could not start the camera \u2014 scan with your camera app instead.');
        });
    });
  } else {
    $('hint').textContent = 'Scan this server\u2019s QR code with your camera app, or restore the link if this phone linked before.';
  }
})();
</script>
</body>
</html>
"##;
