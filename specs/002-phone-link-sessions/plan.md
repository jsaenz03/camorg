# Tier 2 — session-cookie pairing for the phone link

A self-contained implementation plan. A fresh agent should be able to execute
this without any prior conversation context. Read the whole plan before
starting, then work the stages in order — each stage ends green and is a
commit, which is also its rollback checkpoint.

---

## 1. Current state (as of 0.4.7 + the Tier 1 hardening)

The phone link is a plain-HTTP listener inside the Tauri app:

- `src-tauri/src/remote_camera.rs` — the whole server. Binds `0.0.0.0` on a
  pinned port; every phone request authenticates by URL-path prefix
  `/t/<token>/` where `<token>` is a 64-bit hex code persisted in
  `phone-link-token` (app data dir). `handle_request` routes `hello`,
  `library`, `img/<file>`, `report`, `bye`, `review`, `report-request`,
  `photo`, `logo.png`, `manifest.webmanifest`.
- Tier 1 already shipped (do not regress any of it):
  - `AuthGuard` — per-source throttling: 10 wrong-code requests / 60 s →
    5-minute block, same-404 response, IP-only diagnostics logging. A
    valid-token request is checked **before** the block and clears the
    source's history (so a re-scanned phone always reconnects).
  - `reset_pairing_token` command ("New code" in the dialog): stop →
    delete token file → restart on the same pinned port. Registered in
    `src-tauri/src/lib.rs`.
  - Windows NSIS firewall hook (`src-tauri/installer-hooks.nsh`) scoped to
    LocalSubnet + 100.64.0.0/10.
  - `legal/security-notes.md` documents all of the above.
- `src-tauri/src/remote_camera_page.rs` — `PAGE_HTML`, the single-page phone
  client. All fetches are **relative** (`fetch('hello')`, `'library'`,
  `'img/'+id+'.jpg'`, POST `photo`, etc.), so it works mounted under any
  path. It reconnects: `probe()` every 3 s while disconnected, `beat()` every
  60 s while connected, both treat non-`res.ok` as disconnected. PWA manifest
  (`WEB_MANIFEST` in remote_camera.rs) uses `start_url: "./"` and
  `scope: "./"`, resolving under whatever path serves it.
- Desktop UI: `components/companion/phone-link-dialog.tsx` (QR, Tailscale
  section, New code + End session) and
  `components/companion/companion-provider.tsx` (session lifecycle,
  `regenerate()`). These should need **no structural changes** in Tier 2.
- Tests: cargo unit tests inside `remote_camera.rs` (AuthGuard, pairing URL
  minting, page-HTML string contracts, port rebind); Playwright smoke tests
  (login flow only). Run: `cd src-tauri && cargo test`, `npx tsc --noEmit`,
  `npm run lint`, `npm test`.

**The problem Tier 2 fixes:** the long-lived pairing code rides in the URL of
*every* request. It therefore appears in any intermediate log, the phone's
browser history expansion, and each cleartext request on the LAN. There is
also no server-side session to revoke — "End session" stops the listener, but
possession of the code is the only credential.

## 2. Goal and non-goals

**Goal.** The QR's pairing code becomes an *exchange* credential: presenting
it once mints a per-device session cookie; all subsequent requests
authenticate by cookie on token-less paths. This gives:

1. The long-lived secret crosses the wire once per pairing, not per request.
2. Server-side revocation: "End session" kills all live sessions without
   rotating the pairing code; "New code" rotates the code *and* kills
   sessions.
3. Per-device sessions (groundwork; a future UI could list/kill devices).

**Non-goals (do not attempt):**

- No TLS on the LAN listener. Certificate-less HTTPS is not a thing; the
  encrypted path remains Tailscale. Do not add `Secure` to the cookie — it
  would never be sent over plain HTTP.
- No version-skew compatibility layer. The phone page is served by the same
  binary that ships the server; there is no old-client/new-server matrix.
  The only legacy artefacts are phones' **saved home-screen icons** and any
  cached pages pointing at `/t/<code>/` URLs — handled in §4.5.
- No per-device management UI, no multiple concurrent pairing codes, no
  database changes, no new Tauri commands, no version bump (releases are a
  separate three-file ritual per CLAUDE.md).

**Honest security framing** (keep this in `legal/security-notes.md` when you
update it): a leaked pairing code still pairs until rotated — Tier 2 does not
change that. What changes: the code stops appearing in per-request URLs, and
sessions become revocable server-side. A LAN attacker who can sniff can still
capture the exchange or the cookie; Tailscale remains the answer there.

## 3. Protocol design

### 3.1 Endpoints

| Request | Auth | Behaviour |
|---|---|---|
| `GET /t/<code>/` | pairing code | Validate code. Wrong code → 404 (and AuthGuard counts it, exactly as today). Valid → `303 See Other` to `/`, plus `Set-Cookie`. |
| `GET /` (and `/index.html`, `logo.png`, `manifest.webmanifest`) | session cookie | Serve the same assets served today under the token path. |
| `GET/POST /hello`, `/library`, `/img/…`, `/report`, `/bye`, `/review`, `/report-request`, `/photo` | session cookie | Identical handling to today, minus the path prefix. |

Keep serving every existing route under `/t/<code>/…` **only** as the
exchange redirect (any path under it 303s to `/` after cookie mint) — that is
what makes old saved icons and old QR photos keep working.

### 3.2 Cookie

```
Set-Cookie: camog_session=<32-hex>; Path=/; HttpOnly; SameSite=Strict
```

- 128-bit random hex (two `rand::random::<u64>()`, or one 128-bit draw).
- Session cookie: **no** `Max-Age`/`Expires` (dies with the browser session,
  which for a standalone PWA is fine).
- **No** `Secure` flag (plain HTTP — see non-goals).
- `SameSite=Strict` is safe: every request is same-origin.
- `sendBeacon('bye')` and all `fetch()` calls are same-origin → cookies are
  sent by default; no `credentials` option needed. Verify once manually.

### 3.3 Server state

- `SessionStore` inside the `RemoteCamera` struct (not a static): a
  `Mutex<HashSet<[u8; 16]>>` of live session ids. In-memory by design —
  a desktop restart naturally invalidates every phone session, and phones
  recover by re-running the exchange from their saved `/t/<code>/` URL.
  `stop_remote_camera()` dropping the struct *is* session revocation.
- Sessions minted only via a valid pairing code. No expiry while the link
  runs (the 30-minute idle auto-close already bounds lifetime).
- `reset_pairing_token` needs no extra work for sessions (stop → start drops
  them), but its diagnostics line should say phones must re-scan.

### 3.4 Auth evaluation order (critical — preserves a Tier 1 property)

In `handle_request`:

1. Extract source IP (as today).
2. If the URL starts with `/t/<token>/` and the token matches the live one:
   treat as **exchange** → mint session, set cookie, 303 to `/`. Do **not**
   clear AuthGuard history here? — yes, do clear it: presenting the valid
   code is proof of legitimacy, same as a valid-token request today.
3. Else if a valid `camog_session` cookie is present: authenticated →
   clear AuthGuard history for the IP, update `last_seen_ms`, route as today.
4. Else (wrong code, missing/expired cookie, unknown path): count a failure
   in AuthGuard (same thresholds/response as today), respond 404.

The load-bearing property carried over from Tier 1: a blocked address that
presents a *valid* credential is served and unblocked — the re-scanning
phone must never be locked out by its own dead-URL retry loop.

### 3.5 Phone page changes (`remote_camera_page.rs`)

- The exchange is invisible to the page: opening `/t/<code>/` redirects to
  `/` with the cookie set, and all existing relative fetches keep working.
- Dead cookie (desktop restarted is handled by retry; cookie evicted while
  server alive is the new case): authenticated requests return 404 → the
  existing `res.ok` handling already flips the page to its disconnected
  screen, and the retry loop will 404 forever. Add one thing: when `probe()`
  gets a **404 specifically** (server reachable, session dead), show
  "Pairing expired — re-scan the code in Camog." instead of the generic
  "Cannot reach Camog" text, and stop the 3-second retry loop (or slow it to
  ~30 s) so an expired phone doesn't hammer itself into an AuthGuard block.
  - Mind the AuthGuard maths: a retrying phone with a dead cookie counts as
    unauthenticated. With the current 3 s loop it would hit 10 failures in
    30 s and self-block for 5 minutes. The block is cosmetic (a re-scan
    presents the valid code and is cleared per §3.4) but the retry loop
    should still back off — this is also why step 2's clear-on-exchange
    matters.
- PWA: `WEB_MANIFEST` keeps `start_url: "./"`, now resolving to `/`. Icons
  saved *after* Tier 2 launch at `/`; if their cookie is later evicted they
  show the re-scan message (accepted trade-off, documented). Icons saved
  *before* Tier 2 launch at `/t/<code>/` and self-heal through the exchange.

### 3.6 What must NOT change

- Pairing URL shape (`http://ip:port/t/<code>/`) — the QRs, the Tailscale
  section, the pinned port, the persisted token file, `remote_camera_active`
  output, and every saved phone icon depend on it.
- `AuthGuard` thresholds and its IP-only logging.
- Desktop UI structure (`phone-link-dialog.tsx` landscape two-column layout,
  New code + End session buttons). Copy edits only, if any.
- The capture pipeline, library manifest/whitelist mechanics, report staging,
  idle watchdog (it keeps counting authenticated requests via
  `last_seen_ms`).

## 4. Implementation stages

Work on a branch; `main` stays untouched until the manual checklist in §5
passes on a real machine. Every stage ends with the full green gate:
`cargo test` && `npx tsc --noEmit` && `npm run lint` && `npm test`.

### Stage 0 — rollback checkpoint

```
git checkout -b tier2-pairing-sessions
git tag pre-tier2        # the rollback point
```

Rollback at any later moment: `git checkout main` (nothing landed) or, once
merged, `git revert <range>` / reset to `pre-tier2`. There is **no data
migration** in Tier 2 (sessions are in-memory; token/port files unchanged),
so no data rollback procedure exists or is needed — state that in the PR.

### Stage 1 — Rust core, tested, not yet wired

Add to `remote_camera.rs`:

- `SessionStore` (mint/contains/remove_all semantics; `[u8; 16]` ids).
- Cookie serialisation/parsing helpers (`Set-Cookie` header build; parse
  `Cookie: camog_session=<hex>` from request headers — tiny_http exposes
  `request.headers()`).
- An `AuthOutcome`-style pure function covering §3.4's decision table,
  taking (url, cookie-header, live-token, store, source-ip) and returning
  the action — so the decision logic is unit-testable without an `AppHandle`.
- Unit tests: valid exchange mints+redirects; wrong code 404s and counts;
  valid cookie routes; dead cookie counts + 404; exchange clears AuthGuard
  history; session ids unique. Rust will flag the unwired code — either wire
  `SessionStore` into `RemoteCamera` in this stage (field + drop semantics)
  or add the wiring in Stage 2 with `#[allow(dead_code)]` removed then.

Commit: `tier2: session store + auth decision core (unused)`.

### Stage 2 — protocol switch

- Rework `handle_request` to the §3.4 order; move asset/control routes to
  the root path; keep `/t/<code>/` as exchange-only.
- `remote_camera_page.rs`: the 404-vs-network-error distinction in
  `probe()`/`beat()` per §3.5, with the re-scan message and backed-off retry.
- Update/extend the PAGE_HTML string-contract tests (they assert on literal
  strings — e.g. `fetch('library')` stays, add the new 404 branch marker)
  and the routing unit tests from Stage 1 to the wired behaviour.
- Verify the exchange by hand with curl before touching a phone:
  `curl -i http://127.0.0.1:<port>/t/<code>/` → 303 + Set-Cookie;
  `curl -i -b camog_session=… http://127.0.0.1:<port>/hello` → ok;
  wrong cookie → 404.

Commit: `tier2: cookie sessions on the tether protocol`.

### Stage 3 — docs, copy, and the manual gate

- `legal/security-notes.md`: rewrite the "Access control" bullet for
  exchange+cookie, note the cookie is HttpOnly/SameSite=Strict/session-scoped,
  note the accepted re-scan trade-off for evicted cookies, keep the honest
  "leaked code still pairs until rotated" framing. Keep
  `legal/README.md`'s accuracy bullet in sync (it also mentions plain-HTTP
  tether — still true).
- Dialog footnote (`phone-link-dialog.tsx`) only if it now misstates
  behaviour: "End session" now also signs out paired phones — one clause at
  most. AU English.
- Run the full §5 manual checklist on a real machine + real phone.
- Tag `tier2-verified` after the checklist passes. This is the second
  rollback checkpoint (everything before it is disposable).

Commit: `tier2: docs + copy for session pairing`.

## 5. Manual verification checklist (Stage 3 gate)

Run `npm run desktop`, pair a real phone, and confirm every row:

1. Fresh pair: QR scan → redirect lands on the phone page, "Connected".
2. Old saved home-screen icon (saved pre-Tier 2) still opens and connects.
3. Save a new home-screen icon; kill the app, reopen (auto-start on) → icon
   reconnects via exchange.
4. Take a photo from the phone camera; send one from the phone library.
5. Library tab: browse patients, open a photo, blur toggle, compare view.
6. Mark a patient reviewed from the phone; request a case report and
   download/share it (standalone PWA path included).
7. Tailscale QR (if a tailnet is available): pairs and works.
8. Desktop restart mid-session: phone flips to reconnecting, recovers.
9. Clear the phone's website data for the origin (simulated cookie
   eviction): page shows the re-scan message and backs off, does NOT
   tight-loop; re-scan pairs cleanly.
10. "End session": phone's next request fails → reconnecting screen;
    restarting the link WITHOUT rotating the code does not revive the old
    cookie (sessions died with the listener).
11. "New code": old QR/URL dead (404), new QR pairs; diagnostics shows the
    rotation line.
12. Wrong-code hammering from a laptop (curl loop) → diagnostics shows
    "Rejected…" then "Paused requests…"; a subsequent valid QR scan from the
    same IP succeeds immediately (AuthGuard clear-on-valid).
13. Settings → Diagnostics shows no token/session values in any line.
14. 30-minute idle auto-close still ends the link (can be code-inspected
    rather than waited out: assert `last_seen_ms` updates only on
    authenticated requests).

## 6. Rollback plan (summary — the user explicitly asked for this)

- **Checkpoint 0:** tag `pre-tier2` on `main` before any work. Nothing lands
  on `main` until §5 passes.
- **Checkpoint per stage:** one commit per stage, always leaving the gate
  green — any stage can be dropped by reverting its commit.
- **Checkpoint 2:** tag `tier2-verified` after the manual gate.
- **Rollback procedure:** `git checkout main && git branch -D
  tier2-pairing-sessions` (pre-merge), or `git revert` the merged range /
  `git reset --hard pre-tier2` (post-merge, before release). No persisted
  data changes exist, so a rollback leaves every phone working: the URL
  shape is unchanged, and pre-Tier 2 binaries accept `/t/<code>/` directly
  again. Phones that saved icons mid-Tier 2 hit `/` on the old binary →
  404 → they re-scan once. That is the entire user-visible rollback cost.

## 7. Guardrails for the implementing agent

- Surgical changes only; match the existing comment style (the file explains
  *why*, densely). AU English in all user-facing copy.
- No new dependencies — cookie parsing is a few lines; do not add a cookie
  crate.
- Keep `handle_request`'s Tauri-dependent shell thin; keep pure logic pure
  and tested (the codebase's testing pattern is std-only unit tests in-file).
- Leave the runnable checks behind: the Stage 1/2 unit tests are the
  permanent regression net; update the PAGE_HTML string contracts rather
  than deleting them.
- If any stage reveals the design is wrong (e.g. cookie behaviour on iOS
  standalone breaks pairing entirely), stop and report rather than
  patching around it silently — that is a checkpoint decision, not an
  implementation detail.
