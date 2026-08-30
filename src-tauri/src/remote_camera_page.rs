// The companion phone page served at the pairing URL. Kept as a separate
// included file so remote_camera.rs stays readable; everything here ships to
// the phone as one static HTML document (no external assets, no build step).

const PAGE_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a" id="meta-theme">
<title>Camog &middot; Phone link</title>
<style>
  /* Camog theme — mirrors app/globals.css tokens. Dark is the default
     (photo review); body.light flips to the app's light palette. */
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
    --success: #16a34a;
    --warn: #b45309;
    --error: #dc2626;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; min-height: 100dvh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(70% 40% at 50% 0, rgba(0, 174, 181, 0.08), transparent 70%) var(--bg);
    color: var(--fg);
    -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  [hidden] { display: none !important; }

  /* Screens: camera keeps the centred hero layout; library screens are
     top-aligned lists with room for the bottom tab bar. */
  .screen { min-height: 100dvh; padding-bottom: calc(64px + env(safe-area-inset-bottom)); }
  #screen-cam {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 20px; padding: 24px 16px;
  }
  #screen-lib, #screen-patient { padding: 16px 16px calc(76px + env(safe-area-inset-bottom)); }

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
    background: rgba(0, 174, 181, 0.12);
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

  /* Theme toggle: fixed top-right, hidden while a full-screen surface is open. */
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

  /* Bottom tab bar. */
  #tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
    display: flex; justify-content: center; gap: 8px;
    padding: 6px 16px calc(6px + env(safe-area-inset-bottom));
    background: var(--overlay);
    -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
  }
  .tab {
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
  }
  .topbar h2 { flex: 1; text-align: left; }
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
  #search {
    width: 100%; min-height: 44px; padding: 10px 14px; margin-bottom: 8px;
    border-radius: var(--radius); border: 1px solid var(--border); background: var(--card);
    color: var(--fg); font-size: 16px; /* 16px+ so iOS never zooms the field */
  }
  #search::placeholder { color: var(--muted); }
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
  .flag { font-size: 12px; font-weight: 600; margin-top: 3px; }
  .flag-overdue { color: var(--error); }
  .flag-warn { color: var(--warn); }
  .flag-quiet { color: var(--muted); font-weight: 500; }

  /* Patient detail. */
  #patient-meta { text-align: left; max-width: none; }
  #patient-actions { display: flex; gap: 8px; margin-top: 12px; }
  #patient-actions .btn { flex: 1; max-width: none; font-size: 15px; min-height: 44px; padding: 10px 8px; }
  #patient-status { min-height: 20px; margin-top: 8px; font-size: 13px; color: var(--muted); text-align: left; }
  #patient-status.ok { color: var(--success); }
  #patient-status.err { color: var(--error); }

  /* Photo grid. */
  #grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 8px; }
  #grid button {
    display: block; position: relative; width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
    background: var(--card);
  }
  #grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Body-map indicator: where on the patient this photo was taken. */
  #grid .cell-fig {
    position: absolute; right: 3px; bottom: 3px; width: 24px;
    background: rgba(0, 0, 0, 0.55); border-radius: 5px; padding: 2px;
    pointer-events: none;
  }
  .empty { padding: 48px 12px; text-align: center; color: var(--muted); font-size: 15px; }

  /* Full-screen surfaces (cover the tab bar). */
  #screen-viewer, #screen-compare {
    position: fixed; inset: 0; z-index: 20; background: #000;
    display: flex; flex-direction: column;
  }
  .surface-top {
    display: flex; align-items: center; gap: 8px; padding: 8px 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
    color: #fafafa;
  }
  .surface-top .iconbtn { color: #fafafa; }
  .surface-top .iconbtn:active { background: rgba(255,255,255,0.12); }
  #viewer-top .count { flex: 1; text-align: center; font-size: 14px; color: #a1a1aa; }
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
    display: flex; gap: 14px; align-items: center;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: rgba(10, 10, 10, 0.94); border-top: 1px solid rgba(255, 255, 255, 0.1);
    color: #fafafa;
  }
  #viewer-meta .txt { flex: 1; min-width: 0; }
  #viewer-meta .line1 { font-size: 15px; font-weight: 600; }
  #viewer-meta .line2 { font-size: 13px; color: #a1a1aa; margin-top: 3px; }
  #viewer-meta .notes { font-size: 14px; opacity: 0.85; margin-top: 8px; line-height: 1.45; }

  /* Body map figure (geometry shared with the desktop picker). */
  .bodyfig { display: block; }
  .bodyfig [data-part] { fill: rgba(161, 161, 170, 0.30); stroke: rgba(161, 161, 170, 0.5); stroke-width: 1.5; }
  .bodyfig [data-part].hl { fill: var(--primary); stroke: var(--primary); }

  /* Compare (mirrors the desktop dialog): two pickers, side-by-side or
     overlay modes, one shared zoom + pan across both photos. The compare
     surface stays dark like the viewer, in both themes. */
  #compare-title { flex: 1; text-align: center; font-size: 16px; font-weight: 600; color: #fafafa; }
  #compare-controls { padding: 0 10px 8px; display: flex; flex-direction: column; gap: 8px; }
  .cmp-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cmp-pickers label { font-size: 12px; color: #a1a1aa; display: block; margin-bottom: 3px; }
  .cmp-pickers select {
    width: 100%; min-height: 40px; padding: 6px 8px; border-radius: var(--radius);
    border: 1px solid rgba(255, 255, 255, 0.14); background: #171717; color: #fafafa; font-size: 14px;
  }
  .cmp-row { display: flex; align-items: center; gap: 6px; }
  .cmp-mode { display: flex; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 8px; overflow: hidden; }
  .cmp-mode button {
    min-height: 38px; padding: 0 10px; font-size: 13px; font-weight: 600; color: #a1a1aa;
    display: flex; align-items: center; gap: 5px;
  }
  .cmp-mode button[aria-pressed="true"] { background: var(--primary); color: var(--primary-fg); }
  .cmp-mode svg { width: 15px; height: 15px; }
  .cmp-zoom { margin-left: auto; display: flex; align-items: center; gap: 4px; color: #fafafa; }
  .cmp-zoom .pct { min-width: 40px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
  .cmp-zoom button {
    width: 38px; height: 38px; border-radius: 8px; color: #fafafa;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
  .cmp-zoom svg { width: 16px; height: 16px; }
  #cmp-opacity-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa; }
  #cmp-opacity { flex: 1; accent-color: var(--primary); }
  #compare-stage { flex: 1; min-height: 0; padding: 0 8px 8px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
  #cmp-frame { height: 100%; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px; overflow: hidden; }
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
  }
</style>
</head>
<body class="theme-dark">
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
      <label class="btn btn-primary" for="photo">Take photo</label>
      <input id="photo" type="file" accept="image/*" capture="environment" hidden>
    </div>
    <div id="screen-review" hidden style="width:100%">
      <h1>Use this photo?</h1>
      <img id="preview" alt="Photo to send">
      <button type="button" class="btn btn-primary" id="send">Send to Camog</button>
      <button type="button" class="btn btn-secondary" id="retake">Retake</button>
    </div>
    <div id="screen-sent" hidden style="width:100%">
      <div class="check" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <h1>Photo sent</h1>
      <p>Check Camog on your computer to add details and save it.</p>
      <button type="button" class="btn btn-primary" id="another">Take another photo</button>
      <button type="button" class="btn btn-secondary" id="sent-lib" hidden>Open library</button>
    </div>
    <p id="error"></p>
  </main>

  <!-- Library: patient list -->
  <main id="screen-lib" class="screen" hidden>
    <div class="topbar">
      <h2>Library</h2>
      <button type="button" class="iconbtn" id="refresh" aria-label="Refresh library">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
      </button>
    </div>
    <input id="search" type="search" placeholder="Search patients" autocomplete="off" aria-label="Search patients">
    <div id="patients" role="list"></div>
    <div id="lib-empty" class="empty" hidden>No patients to show yet.</div>
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
    <div id="patient-actions">
      <button type="button" class="btn btn-outline" id="review-btn">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        Mark reviewed
      </button>
      <button type="button" class="btn btn-outline" id="report-btn">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        Case report
      </button>
    </div>
    <p id="patient-status" aria-live="polite"></p>
    <div id="grid"></div>
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
    </div>
  </div>

  <!-- Compare (like the desktop dialog): pickers + side/overlay + shared pan/zoom -->
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

  <button type="button" id="theme" aria-label="Switch light or dark appearance">
    <svg class="i-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
    <svg class="i-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>

  <nav id="tabbar" role="tablist" aria-label="Sections">
    <button type="button" class="tab" id="tab-cam" role="tab" aria-selected="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
      Camera
    </button>
    <button type="button" class="tab" id="tab-lib" role="tab" aria-selected="false" hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      Library
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

  // ---- Theme (dark is the default; the choice persists on the phone) -----
  var THEME_KEY = 'camog-theme';
  function applyTheme(light) {
    document.body.classList.toggle('light', light);
    document.body.classList.toggle('theme-dark', !light);
    $('meta-theme').setAttribute('content', light ? '#f4f4f5' : '#0a0a0a');
  }
  applyTheme(localStorage.getItem(THEME_KEY) === 'light');
  $('theme').addEventListener('click', function () {
    var light = !document.body.classList.contains('light');
    applyTheme(light);
    try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (e) { /* private mode */ }
  });

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

  // ---- Library manifest --------------------------------------------------
  function fetchLibrary() {
    return fetch('library').then(function (res) { return res.json(); }).then(function (data) {
      lib = data.viewing ? data : null;
      show($('tab-lib'), !!lib);
      show($('sent-lib'), !!lib);
      return lib;
    });
  }

  // ---- Tabs --------------------------------------------------------------
  function setTab(tab) {
    show($('screen-cam'), tab === 'cam');
    show($('screen-lib'), tab === 'lib' && !state.patientId);
    show($('screen-patient'), tab === 'lib' && !!state.patientId);
    $('tab-cam').setAttribute('aria-selected', tab === 'cam' ? 'true' : 'false');
    $('tab-lib').setAttribute('aria-selected', tab === 'lib' ? 'true' : 'false');
    show($('theme'), !viewerOpen() && !compareOpen());
    if (tab === 'lib') renderLibrary();
  }
  $('tab-cam').addEventListener('click', function () { setTab('cam'); });
  $('tab-lib').addEventListener('click', function () { setTab('lib'); });

  // ---- Connect + initial data --------------------------------------------
  // Relative URLs resolve under /t/<token>/, so the token never appears here.
  fetch('hello').then(function () {
    $('conn').textContent = 'Connected. Take the photo, review it, then send it.';
    $('conn').style.color = 'var(--success)';
  }).catch(function () {
    fail('Cannot reach Camog.\nMake sure the Camog app is open and your phone is on the same Wi-Fi.');
  });
  fetchLibrary().catch(function () { /* library stays hidden; capture still works */ });

  // Tell the desktop when the page goes away so it can clear "connected".
  addEventListener('pagehide', function () { navigator.sendBeacon('bye'); });

  // ---- Capture flow (unchanged pipeline) ----------------------------------
  $('photo').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    fail('');
    shrink(file).then(function (blob) {
      pending = blob;
      $('preview').src = URL.createObjectURL(blob);
      camScreen('screen-review');
    }).catch(function () {
      fail('Could not read that photo. Try again.');
    });
  });

  function camScreen(id) {
    ['screen-start', 'screen-review', 'screen-sent'].forEach(function (s) {
      show($(s), s === id);
    });
  }

  $('retake').addEventListener('click', function () { camScreen('screen-start'); });
  $('another').addEventListener('click', function () { camScreen('screen-start'); });
  $('sent-lib').addEventListener('click', function () { setTab('lib'); });

  $('send').addEventListener('click', function () {
    if (!pending) return;
    var blob = pending;
    pending = null;
    fail('');
    fetch('photo', { method: 'POST', body: blob }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      camScreen('screen-sent');
    }).catch(function () {
      pending = blob;
      fail('Could not send the photo.\nMake sure Camog is still open, then try again.');
      camScreen('screen-review');
    });
  });

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
      return createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    // ponytail: pre-2021 iOS Safari has no createImageBitmap; img decode applies EXIF anyway.
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
  var state = { patientId: null, query: '' };

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

  function flagHtml(p) {
    var flags = [];
    if (p.review === 'overdue') flags.push('<div class="flag flag-overdue">Review overdue</div>');
    else if (p.review === 'due-soon') flags.push('<div class="flag flag-warn">Review due soon</div>');
    else if (p.review === 'scheduled' && p.reviewDueAt) flags.push('<div class="flag flag-quiet">Review ' + fmtDate(p.reviewDueAt) + '</div>');
    else if (p.review === 'stale') flags.push('<div class="flag flag-quiet">Not reviewed lately</div>');
    if (p.consent === 'expired') flags.push('<div class="flag flag-warn">Consent expired</div>');
    else if (p.consent === 'none') flags.push('<div class="flag flag-warn">No consent on record</div>');
    return flags.join('');
  }

  function renderLibrary() {
    if (!lib) return;
    var rows = patientsFor(state.query);
    var host = $('patients');
    host.innerHTML = '';
    rows.forEach(function (p) {
      var meta = p.photoCount + (p.photoCount === 1 ? ' photo' : ' photos');
      if (p.lastPhotoAt) meta += ' \u00b7 last ' + fmtDate(p.lastPhotoAt);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'patient-row';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML =
        '<span class="grow"><span class="name"></span>' +
        '<div class="meta"></div>' + flagHtml(p) + '</span>' +
        '<svg class="chev" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      btn.querySelector('.name').textContent = p.name;
      btn.querySelector('.meta').textContent = meta;
      btn.addEventListener('click', function () { openPatient(p.id); });
      host.appendChild(btn);
    });
    show($('lib-empty'), rows.length === 0);
    show($('search'), lib.patients.length > 0);
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

  function renderPatientActions() {
    // Reviewing again is always legitimate, so the button stays enabled; the
    // review flag itself updates on the patient list after a refetch.
    $('review-btn').disabled = false;
    $('review-btn').lastChild.textContent = 'Mark reviewed';
    var p = currentPatient();
    if (!p) return;
    var status = $('patient-status');
    status.className = p.statusClass || '';
    status.textContent = p.statusText || '';
  }

  function currentPatient() {
    if (!lib || !state.patientId) return null;
    var found = null;
    lib.patients.forEach(function (x) { if (x.id === state.patientId) found = x; });
    return found;
  }

  function openPatient(patientId) {
    if (!lib) return;
    state.patientId = patientId;
    var p = currentPatient();
    if (!p) return;
    $('patient-name').textContent = p.name;
    $('patient-meta').textContent = p.photoCount + (p.photoCount === 1 ? ' photo' : ' photos');
    $('patient-status').textContent = '';
    $('patient-status').className = '';
    renderPatientActions();
    renderGrid();
    setTab('lib');
    history.pushState({ view: 'patient' }, '');
  }

  function renderGrid() {
    var grid = $('grid');
    grid.innerHTML = '';
    photosFor(state.patientId).forEach(function (e) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute('aria-label', e.p.bodyPartLabel + ', ' + fmtDate(e.p.capturedAt));
      var img = document.createElement('img');
      img.src = 'img/' + e.p.id + '.thumb.jpg';
      img.alt = '';
      img.loading = 'lazy';
      cell.appendChild(img);
      // Body-map indicator: where on the patient this was taken.
      var fig = bodyFigure(e.p.bodyPart, e.p.laterality);
      fig.classList.add('cell-fig');
      cell.appendChild(fig);
      cell.addEventListener('click', function () { openViewer(e.i); });
      grid.appendChild(cell);
    });
    updateCompareButton();
  }

  $('back').addEventListener('click', function () { history.back(); });

  function closePatient() {
    state.patientId = null;
    if (lib) setTab('lib');
  }

  // ---- Mark reviewed / case report (desktop does the work) ----------------
  function postPatientRequest(path, patientId) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: patientId }),
    }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
    });
  }

  $('review-btn').addEventListener('click', function () {
    var p = currentPatient();
    if (!p) return;
    var status = $('patient-status');
    status.className = '';
    status.textContent = 'Marking reviewed on your computer\u2026';
    postPatientRequest('review', p.id).then(function () {
      // The desktop stamps the review and refreshes the manifest; pick it up.
      return fetchLibrary().catch(function () {});
    }).then(function () {
      status.className = 'ok';
      status.textContent = 'Marked as reviewed on your computer.';
    }).catch(function () {
      status.className = 'err';
      status.textContent = 'Could not reach Camog. Try again.';
    });
  });

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
      var a = document.createElement('a');
      a.href = 'report';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }).catch(function () {
      status.className = 'err';
      status.textContent = 'Could not prepare the report. Try again.';
      btn.disabled = false;
    });
  });

  // ---- Compare (mirrors the desktop dialog) --------------------------------
  // Two pickers (Earlier / reference, Later / current), side-by-side or
  // overlay mode with an opacity slider, and ONE shared zoom + pan applied
  // to both photos: dragging or pinching either image moves them in lockstep.
  function viewerOpen() { return !$('screen-viewer').hidden; }
  function compareOpen() { return !$('screen-compare').hidden; }

  var cmp = {
    photos: [], leftId: null, rightId: null,
    mode: 'side', opacity: 50,
    zoom: 1, ox: 0, oy: 0,
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
    cmp.zoom = 1;
    cmp.ox = 0;
    cmp.oy = 0;
    buildPickers();
    renderCompare();
    show($('screen-compare'), true);
    show($('theme'), false);
    history.pushState({ view: 'compare' }, '');
  }

  function cmpPane(entry) {
    var pane = document.createElement('div');
    pane.className = 'cmp-pane';
    var img = document.createElement('img');
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
      if (left) grid.appendChild(cmpPane(left));
      if (right) grid.appendChild(cmpPane(right));
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

  function cmpApplyTransform() {
    var t = 'translate(' + cmp.ox + 'px,' + cmp.oy + 'px) scale(' + cmp.zoom + ')';
    var imgs = document.querySelectorAll('#cmp-frame img');
    Array.prototype.forEach.call(imgs, function (img) { img.style.transform = t; });
    $('zoom-pct').textContent = Math.round(cmp.zoom * 100) + '%';
  }

  function cmpZoomBy(factor) {
    cmp.zoom = cmpClampZoom(cmp.zoom * factor);
    cmpApplyTransform();
  }

  $('zoom-in').addEventListener('click', function () { cmpZoomBy(1.25); });
  $('zoom-out').addEventListener('click', function () { cmpZoomBy(0.8); });
  $('zoom-reset').addEventListener('click', function () {
    cmp.zoom = 1;
    cmp.ox = 0;
    cmp.oy = 0;
    cmpApplyTransform();
  });
  $('mode-side').addEventListener('click', function () { cmp.mode = 'side'; renderCompare(); });
  $('mode-overlay').addEventListener('click', function () { cmp.mode = 'overlay'; renderCompare(); });
  $('cmp-opacity').addEventListener('input', function () {
    cmp.opacity = Number(this.value);
    renderCompare();
  });
  $('compare-btn').addEventListener('click', function () { openCompare(); });
  $('compare-back').addEventListener('click', function () { history.back(); });

  // Shared pan (one finger) and pinch zoom (two fingers) on the compare
  // frame; every image moves together, like the desktop's shared viewport.
  (function () {
    var frame = $('cmp-frame');
    function touchDist(ev) {
      var dx = ev.touches[0].clientX - ev.touches[1].clientX;
      var dy = ev.touches[0].clientY - ev.touches[1].clientY;
      return Math.max(1, Math.sqrt(dx * dx + dy * dy));
    }
    frame.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 1) {
        cmp.drag = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, ox: cmp.ox, oy: cmp.oy };
      } else if (ev.touches.length >= 2) {
        cmp.drag = null;
        cmp.pinch = { dist: touchDist(ev), zoom: cmp.zoom };
      }
    }, { passive: true });
    frame.addEventListener('touchmove', function (ev) {
      if (cmp.pinch && ev.touches.length >= 2) {
        ev.preventDefault();
        cmp.zoom = cmpClampZoom(cmp.pinch.zoom * (touchDist(ev) / cmp.pinch.dist));
        cmpApplyTransform();
      } else if (cmp.drag && ev.touches.length === 1) {
        ev.preventDefault();
        cmp.ox = cmp.drag.ox + (ev.touches[0].clientX - cmp.drag.x);
        cmp.oy = cmp.drag.oy + (ev.touches[0].clientY - cmp.drag.y);
        cmpApplyTransform();
      }
    }, { passive: false });
    frame.addEventListener('touchend', function (ev) {
      if (ev.touches.length === 0) {
        cmp.drag = null;
        cmp.pinch = null;
      } else if (ev.touches.length === 1) {
        cmp.pinch = null;
        cmp.drag = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, ox: cmp.ox, oy: cmp.oy };
      }
    }, { passive: true });
  })();

  function closeCompare() {
    show($('screen-compare'), false);
    show($('theme'), true);
  }

  // ---- Viewer -------------------------------------------------------------
  var viewer = { photos: [], idx: 0, touchX: null, lastTap: 0 };

  function openViewer(id) {
    viewer.photos = photosFor(state.patientId);
    // `id` is the photo's index in the shared manifest (lib.photos), but
    // viewer.photos is the per-patient subset in its own order — resolve by
    // id, never by position, or the tap opens a different patient's photo.
    var idx = -1;
    viewer.photos.forEach(function (x, k) { if (x.i === id) idx = k; });
    if (idx < 0) return;
    viewer.idx = idx;
    renderViewer();
    show($('screen-viewer'), true);
    show($('theme'), false);
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
    $('viewer-title').textContent = e.p.bodyPartLabel + (e.p.subpart ? ' \u00b7 ' + e.p.subpart : '');
    $('viewer-date').textContent = 'Taken ' + fmtDate(e.p.capturedAt);
    var notes = $('viewer-notes');
    if (e.p.notes) {
      notes.textContent = e.p.notes;
      show(notes, true);
    } else {
      show(notes, false);
    }
  }

  function closeViewer() {
    show($('screen-viewer'), false);
    show($('theme'), true);
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
