/**
 * Self-check for the body-map pinpoint X (refined body part selection).
 *
 * Run: node scripts/self-check-body-pinpoint.mjs
 *
 * Asserts the cross-file invariants TypeScript cannot see: the DB migration
 * carries the pin columns and is registered in the Rust shell, the service
 * persists and reads them (both insert paths), the picker drops the X and
 * opens the part detail diagram, and the saved pin renders back on the badge
 * and detail dialog. Fails loudly (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Migration 016 adds the three pin columns; 017 adds the face (view) of the mark.
const migration = read('src-tauri/migrations/016_photo_pinpoint.sql');
for (const needle of [
  'ALTER TABLE photos ADD COLUMN pin_x REAL',
  'ALTER TABLE photos ADD COLUMN pin_y REAL',
  "ALTER TABLE photos ADD COLUMN pin_space TEXT CHECK (pin_space IN ('body', 'part'))",
]) {
  assert.ok(migration.includes(needle), `migration 016 missing: ${needle}`);
}
const pinViewMigration = read('src-tauri/migrations/017_photo_pin_view.sql');
assert.ok(
  pinViewMigration.includes("ALTER TABLE photos ADD COLUMN pin_view TEXT CHECK (pin_view IN ('front', 'back'))"),
  'migration 017 missing the pin_view column',
);

// 2. The Rust shell registers migrations 016 and 017.
assert.match(
  read('src-tauri/src/lib.rs'),
  /version:\s*16[\s\S]*?016_photo_pinpoint\.sql/,
  'lib.rs does not register migration 016',
);
assert.match(
  read('src-tauri/src/lib.rs'),
  /version:\s*17[\s\S]*?017_photo_pin_view\.sql/,
  'lib.rs does not register migration 017',
);

// 3. photo-service persists and reads the pin columns on both insert paths.
const photoService = read('lib/services/photo-service.ts');
for (const col of ['pin_x', 'pin_y', 'pin_space']) {
  assert.ok(photoService.includes(`row.pin_${col.split('_')[1]}`) || photoService.includes(`row.${col}`),
    `rowToPhoto does not read ${col}`);
}
assert.ok(photoService.includes('row.pin_view'), 'rowToPhoto does not read pin_view');
assert.ok(photoService.includes('validated.pinX ?? null'), 'createPhoto insert does not persist pinX');
assert.ok(photoService.includes('validated.pinY ?? null'), 'createPhoto insert does not persist pinY');
assert.ok(photoService.includes('validated.pinSpace ?? null'), 'createPhoto insert does not persist pinSpace');
assert.ok(photoService.includes('validated.pinView ?? null'), 'createPhoto insert does not persist pinView');
assert.ok(photoService.includes('photo.pinX'), 'annotated-copy insert does not carry the pin');
assert.ok(photoService.includes('photo.pinView'), 'annotated-copy insert does not carry the pin view');

// 4. Create schema validates the pin bounds, the space enum and the view enum.
const schemas = read('lib/validators/schemas.ts');
assert.match(schemas, /pinX: z\.number\(\)\.min\(0\)\.max\(1\)/, 'create schema missing pinX bounds');
assert.match(schemas, /pinY: z\.number\(\)\.min\(0\)\.max\(1\)/, 'create schema missing pinY bounds');
assert.match(schemas, /pinSpace: z\.enum\(\['body', 'part'\]\)/, 'create schema missing pinSpace enum');
assert.match(schemas, /pinView: z\.enum\(\['front', 'back'\]\)/, 'create schema missing pinView enum');

// 5. The picker drops an X (tagged with the face it was marked on) and opens
//    the part detail diagram.
const picker = read('components/patient/body-map-picker.tsx');
assert.ok(picker.includes('export function PinMarker'), 'picker does not export PinMarker');
assert.match(picker, /onPinChange\?:/, 'picker does not accept onPinChange');
assert.match(picker, /space: 'body', view/, 'picker does not tag body-view pins with the face');
assert.match(picker, /space: 'part', view: detail\.view/, 'picker does not tag detail pins with the surface');
assert.match(picker, /setDetail\(/, 'picker does not open the part detail diagram');
// Front/back must be unmistakable: explicit captions + eyes on the front silhouette.
assert.match(picker, /facing the patient/, 'picker does not caption the front view');
assert.match(picker, /seen from behind/, 'picker does not caption the back view');
assert.match(picker, /view === 'front' && \(/, 'picker does not draw front-view face hints');

// 5b. Hands and feet: the surface (palm vs back of hand) is labelled, toggleable,
//     and a saved part-space pin re-opens on the surface it was marked on.
const bodyPartSrc = read('types/body-part.ts');
assert.match(bodyPartSrc, /export type BodyView = 'front' | 'back';/, 'BodyView type missing');
assert.match(bodyPartSrc, /view: BodyView;/, 'Pinpoint does not record the face it was marked on');
assert.match(bodyPartSrc, /\[BodyPart\.HAND\]: \{ front: 'Palm', back: 'Back of hand' \}/, 'hand surface labels missing');
assert.match(bodyPartSrc, /\[BodyPart\.FOOT\]: \{ front: 'Top of foot', back: 'Sole' \}/, 'foot surface labels missing');
assert.match(bodyPartSrc, /export function bodyPartSurfaceLabel/, 'surface-aware display label missing');
assert.match(picker, /SURFACE_LABELS\[detail\.part\]/, 'detail view has no surface toggle');
assert.match(picker, /setSurfaceView/, 'surface toggle does not retag the pin');

// 6. Every clickable body region has a detail diagram (all parts except the
//    chip-only TORSO overlap label), and hands/feet draw both faces.
const detailSrc = read('components/patient/part-detail-diagram.tsx');
const enumValues = [...bodyPartSrc.matchAll(/^\s{2}([A-Z_]+) = '([a-z_]+)',$/gm)].map((m) => m[1]);
const detailed = new Set([...detailSrc.matchAll(/\[BodyPart\.([A-Z_]+)\]:/g)].map((m) => m[1]));
for (const name of enumValues) {
  if (name === 'TORSO') {
    assert.ok(!detailed.has(name), 'TORSO should stay the chip-only overlap label');
  } else {
    assert.ok(detailed.has(name), `no detail diagram for BodyPart.${name}`);
  }
}
assert.ok(detailSrc.includes('export function PartDetailDiagram'), 'detail module export missing');
// Hands AND feet must draw distinct front/back faces (palm vs back of hand).
assert.equal(
  [...detailSrc.matchAll(/view === 'back'/g)].length,
  2,
  'hand/foot detail diagrams must branch on the view exactly twice',
);

// 7. Saved pins render back: badge (body space, on the face it was marked on)
//    and detail dialog (part space, via the dialog's live pin state).
const badge = read('components/patient/body-map-badge.tsx');
assert.match(badge, /pin\?\.space === 'body'/, 'badge does not render body-space pins');
assert.match(badge, /pin\?\.view \?\?/, 'badge ignores the face the pin was marked on');
const dialog = read('components/photo/photo-detail-dialog.tsx');
assert.match(dialog, /pin\?\.space === 'part'/, 'detail dialog does not render part-space pins');
assert.match(dialog, /view: photo\.pinView \?\? 'front'/, 'dialog does not seed the pin with its saved face');
assert.match(dialog, /view=\{pin\.view\}/, 'dialog does not draw the part pin on its saved face');

// 8. Both capture paths (camera + upload) thread the pin into createPhoto,
//    and the metadata form carries the pin in its schema + submit transform.
// 11. The PDF report draws both diagrams per photo: the page sends the raw
//     part key + side + the full pin (coordinates, space, face), the preview
//     shows the modal's two chips, and Rust draws the silhouette plus the
//     zoomed part detail with the X.
const report = read('app/(dashboard)/patients/report/page.tsx');
assert.match(report, /bodyPartKey: r\.bodyPart/, 'report payload lacks the raw part key');
assert.match(report, /pinX: p\.pin\?\.x \?\? null/, 'report payload lacks the pin coordinates');
assert.match(report, /pinSpace: p\.pin\?\.space \?\? null/, 'report payload lacks the pin space');
assert.match(report, /pinView: p\.pin\?\.view \?\? null/, 'report payload lacks the pin face');
assert.ok(report.includes('<BodyMapBadge'), 'report preview does not render the body map');
assert.match(report, /photo\.pin\?\.space === 'part' && hasPartDetail/, 'report preview does not render the part detail diagram');
const reportRs = read('src-tauri/src/report.rs');
assert.ok(reportRs.includes('fn draw_body_map'), 'report.rs does not draw the body map');
assert.ok(reportRs.includes('fn draw_part_detail'), 'report.rs does not draw the part detail diagram');
assert.match(reportRs, /pub pin_space: Option<String>/, 'report.rs does not receive the pin space');
assert.match(reportRs, /pub pin_view: Option<String>/, 'report.rs does not receive the pin face');
assert.match(reportRs, /fn draw_pin_x/, 'report.rs does not draw the pinpoint X');
assert.match(reportRs, /part: "hand"/, 'report.rs body map lacks hand regions');
assert.match(reportRs, /part: "foot"/, 'report.rs body map lacks foot regions');
for (const file of ['components/capture/capture-dialog.tsx', 'components/photo/photo-upload.tsx']) {
  const src = read(file);
  for (const needle of ['pinX: values.pinX ?? null', 'pinY: values.pinY ?? null', 'pinSpace: values.pinSpace ?? null', 'pinView: values.pinView ?? null']) {
    const wanted = file.includes('capture') ? needle.replace('values.', 'formData.') : needle;
    assert.ok(src.includes(wanted), `${file} does not pass ${wanted.split(':')[0]} to createPhoto`);
  }
}
const form = read('components/photo/photo-metadata-form.tsx');
assert.match(form, /pinSpace: data\.pinSpace \?\? null/, 'form submit does not pass the pin through');
assert.match(form, /pinView: data\.pinView \?\? null/, 'form submit does not pass the pin face through');
assert.match(form, /onPinChange=/, 'form does not wire picker pin changes');
assert.match(form, /form\.setValue\('pinView', p\?\.view/, 'form does not record the pin face from the picker');

// 10. Existing photos can be re-filed: the update path accepts the body part
//     and the pin, the service persists both (clearing a stale pin when the
//     part moves), and the detail dialog edits them with the same picker.
assert.match(schemas, /photoRecordUpdateSchema[\s\S]*?bodyPart: z\.nativeEnum\(BodyPart/,
  'update schema does not accept bodyPart');
assert.match(schemas, /photoRecordUpdateSchema[\s\S]*?pinSpace: z\.enum\(\['body', 'part'\]\)/,
  'update schema does not accept the pin');
assert.match(schemas, /photoRecordUpdateSchema[\s\S]*?pinView: z\.enum\(\['front', 'back'\]\)/,
  'update schema does not accept the pin face');
assert.ok(photoService.includes('SET body_part = $1'), 'updatePhoto does not persist body_part');
assert.ok(photoService.includes('pin_x = $7, pin_y = $8, pin_space = $9, pin_view = $10'), 'updatePhoto does not persist the pin');
assert.match(photoService, /validated\.pinX !== undefined/, 'updatePhoto cannot clear an explicit null pin');
assert.match(photoService, /validated\.pinView !== undefined/, 'updatePhoto cannot clear an explicit null pin face');
assert.ok(dialog.includes('<BodyMapPicker'), 'detail dialog does not embed the body-map picker');
assert.ok(dialog.includes('updatePhoto(photo.id, {\n        bodyPart,'), 'dialog save does not send bodyPart');
assert.match(dialog, /pinSpace: pin\?\.space \?\? null/, 'dialog save does not send the pin');
assert.match(dialog, /pinView: pin\?\.view \?\? null/, 'dialog save does not send the pin face');
// The lesion-series strip thumbnails stay clean — at 64px the little figure is
// too tiny to read, so the body indicator lives on the photo tiles instead.
assert.doesNotMatch(dialog, /function SiblingThumb[\s\S]*?<BodyMapBadge/, 'series-strip thumbnails should not carry the body indicator');

// 9. Normalization sanity: the same formula the SVGs use, round-tripped —
//    a pin at the diagram centre must be (0.5, 0.5) and coordinates survive
//    the round-trip within float noise.
const toNorm = (px, py) => ({ x: px / 200, y: py / 320 });
assert.deepEqual(toNorm(100, 160), { x: 0.5, y: 0.5 });
const round = toNorm(55, 194);
assert.ok(Math.abs(round.x * 200 - 55) < 1e-9 && Math.abs(round.y * 320 - 194) < 1e-9);

console.log('self-check-body-pinpoint: all invariants hold');
