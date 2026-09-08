# Camog licence activation server

A Cloudflare Worker + D1 database that enforces licence seats at activation
time. The desktop app calls it **once per activation** — the only outbound
connection the product ever makes. Design: `specs/003-licence-activation/spec.md`.

```
POST /v1/activate  { key, deviceId } → 200 { token }        (the app)
GET  /v1/seats?fp=…                               (admin)   list seats
DELETE /v1/seats { fp, deviceId | all }           (admin)   free a seat
GET  /                                            (public)  landing page
GET  /legal/*.md                                  (public)  ToS + Privacy (Store listing links)
```

Secrets and identifiers never live in the repo; they are set once, below.

## First deploy (one-time runbook)

1. **Token-signing keypair** (the worker signs activation tokens; the app
   verifies them offline):
   ```
   node activation-server/scripts/gen-token-keys.mjs
   ```
   Private hex lands in `.keys/activation-token-ed25519.private.hex`.
   **Embed the printed public key in `lib/licence/activation-public-key.ts`**
   (it is already filled in if this file ships with the repo — skip if so).

2. **Create the database and record its id** in `wrangler.toml`
   (`database_id`):
   ```
   npx wrangler d1 create camog-licence
   npx wrangler d1 execute camog-licence --remote --file=activation-server/schema.sql
   ```

3. **Secrets** (run from `activation-server/`):
   ```
   npx wrangler secret put TOKEN_SIGNING_KEY < ../.keys/activation-token-ed25519.private.hex
   npx wrangler secret put ADMIN_TOKEN        # long random string, e.g. openssl rand -hex 32
   ```

4. **Vendor public key**: `wrangler.toml [vars].LICENCE_PUBLIC_KEY` must match
   `lib/licence/public-key.ts` (it ships filled in; re-check after any key
   rotation).

5. **Deploy + smoke test**:
   ```
   cd activation-server && npx wrangler deploy
   curl -s https://<workers-host>/ -o /dev/null -w '%{http_code}\n'   # 200
   curl -s -X POST https://<workers-host>/v1/activate -d '{}'        # 400 bad_request
   ```
   Then a full-path probe with a real key — the `{}` probe cannot catch
   runtime issues (a missing Workers global surfaces only once a key is
   decoded, e.g. Buffer was not available):
   ```
   KEY=$(node scripts/licence-keygen.mjs issue --practice "Smoke Test" \
     --tier solo --seats 1 --days 1 | tail -1)
   curl -s -X POST https://<workers-host>/v1/activate \
     -H 'content-type: application/json' \
     -d "{\"key\":\"$KEY\",\"deviceId\":\"00000000-0000-4000-8000-000000000000\"}"
   # want 200 {"token":"..."}   (then revoke the smoke seat if desired)
   ```

6. **Custom domain** (public face for the Store listing; survives the repo
   going private): in the Cloudflare dashboard attach
   `camog-license.cliniciq.com.au` to the worker (DNS for cliniciq.com.au is
   on Cloudflare). Then point `ACTIVATION_URL` in
   `src-tauri/src/licence_activation.rs` at
   `https://camog-license.cliniciq.com.au/v1/activate` (ships pre-filled —
   verify it resolves before release) and keep the legal documents' URLs on
   the same host.

7. **Legal pages**: `public/legal/*.md` here must stay byte-identical to
   `legal/*.md` (CI checks both this folder and `public/legal/`). After
   editing the source docs:
   ```
   cp legal/terms-of-service.md legal/privacy-policy.md activation-server/public/legal/
   cp legal/terms-of-service.md legal/privacy-policy.md public/legal/
   cd activation-server && npx wrangler deploy
   ```

## Seat moves (support requests)

A user replacing a dead machine emails `admin@cliniciq.com.au`. With the
licence key from your records:

```
export CAMOG_ADMIN_TOKEN=…   # the ADMIN_TOKEN secret
node activation-server/scripts/seat-admin.mjs fp --key '<licence key>'
node activation-server/scripts/seat-admin.mjs list --url https://camog-license.cliniciq.com.au --fp <fp>
node activation-server/scripts/seat-admin.mjs revoke --url https://camog-license.cliniciq.com.au --fp <fp> --device <uuid>
```

Revocation is soft (history kept); the freed seat is reusable immediately and
the old device drops to read-only on its next local token check only if its
licence expires — a revoked device that still holds a valid token keeps
working until the licence term ends (accepted ceiling; see spec 003).

## Hosting the macOS installers here (per release)

The public download links (ToS cl 9.1/18, MACOS_GUIDE, landing page) point at
`/download/` with **stable filenames**, so links never rot between releases.
Workers static assets cap at ~25 MiB per file; the DMGs are ~9–10 MiB —
re-check if the app grows a lot. The binaries are gitignored, so each release:

```
gh release download vX.Y.Z -p 'Camog_X.Y.Z_aarch64.dmg' -p 'Camog_X.Y.Z_x64.dmg' -D /tmp/camog-rel
cp /tmp/camog-rel/Camog_X.Y.Z_aarch64.dmg activation-server/public/download/Camog-macOS-AppleSilicon.dmg
cp /tmp/camog-rel/Camog_X.Y.Z_x64.dmg       activation-server/public/download/Camog-macOS-Intel.dmg
cd activation-server && npx wrangler deploy
```

Windows distribution goes through the Microsoft Store (MSSTORE_GUIDE.md);
the landing page's Store line replaces any direct Windows download. If the
DMGs ever exceed the asset cap, move them to R2 and keep the same URLs.
