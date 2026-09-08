// Self-check for the case-report photo ordering (lib/utils/report-order.ts).
//
// Run: node scripts/self-check-report-order.mjs
//
// Pins what order the report shows photos in:
//  - overall spine stays oldest-to-newest;
//  - photos linked into a lesion series appear as one contiguous block,
//    oldest first within it, no matter how their dates interleave with the
//    rest of the timeline;
//  - a series block sits where its earliest capture falls;
//  - unlinked photos keep pure chronological order among themselves.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { orderReportPhotos } from '../lib/utils/report-order.ts';

let seq = 0;
function photo(days, lesionGroup = null) {
  seq += 1;
  return { id: `photo-${seq}`, capturedAt: new Date(2026, 0, days), lesionGroup };
}
const ids = (photos) => photos.map((p) => p.id);

// ---- the headline invariant: a linked series is never split ----

// A hand series captured 3 Mar and 20 Mar, with an unrelated back photo
// between them on 10 Mar. The patient reads the hand's story in one block.
{
  const hand = [photo(3, 'Left hand'), photo(20, 'Left hand')];
  const back = photo(10);
  const ordered = orderReportPhotos([back, hand[1], hand[0]]);
  const joined = ids(ordered).map((id) =>
    id === hand[0].id || id === hand[1].id ? 'hand' : 'back',
  );
  assert.ok(
    joined.join(',') === 'hand,hand,back',
    `series must be contiguous, got ${joined.join(',')}`,
  );
}

// ---- the spine stays chronological between blocks ----

{
  const a = photo(1, 'Mole');
  const b = photo(2, 'Mole');
  const c = photo(5);
  const d = photo(9);
  const ordered = orderReportPhotos([d, c, b, a]);
  // The series opens on day 1 and runs as one block; the day-5 singleton
  // follows it, not the day-9 photo.
  assert.deepEqual(ids(ordered), [a.id, b.id, c.id, d.id]);
}

// ---- within a series, oldest reads first even if input arrived newest-first ----

{
  const first = photo(2, 'Series A');
  const second = photo(7, 'Series A');
  const third = photo(12, 'Series A');
  assert.deepEqual(ids(orderReportPhotos([third, second, first])), [
    first.id,
    second.id,
    third.id,
  ]);
}

// ---- a series block sits at its earliest capture ----

{
  const series = [photo(15, 'Late series'), photo(18, 'Late series')];
  const early = photo(16);
  const ordered = orderReportPhotos([series[0], early, series[1]]);
  // Both series photos come after the day-16 singleton: the block starts at 15
  // but its first member is day 15... the singleton at 16 sits between the
  // block's start date and the next block, i.e. after the whole block.
  assert.deepEqual(ids(ordered), [series[0].id, series[1].id, early.id]);
}

// ---- multiple series interleave as blocks by their opening dates ----

{
  const s1 = [photo(4, 'S1'), photo(14, 'S1')];
  const s2 = [photo(8, 'S2'), photo(10, 'S2')];
  const lone = photo(1);
  const ordered = orderReportPhotos([s2[0], s1[1], lone, s1[0], s2[1]]);
  assert.deepEqual(ids(ordered), [lone.id, s1[0].id, s1[1].id, s2[0].id, s2[1].id]);
}

// ---- unlinked photos keep pure chronological order ----

{
  const ordered = orderReportPhotos([photo(9), photo(2), photo(5)]);
  assert.deepEqual(
    ordered.map((p) => p.capturedAt.getDate()),
    [2, 5, 9],
  );
}

// ---- identical timestamps have no chronological order; output stays stable ----

{
  seq = 0;
  const first = photo(6);
  const second = photo(6);
  assert.deepEqual(ids(orderReportPhotos([first, second])), [first.id, second.id]);
  assert.deepEqual(ids(orderReportPhotos([second, first])), [second.id, first.id]);
}

// ---- edge cases: nothing in, one photo, whole report is one series ----

assert.deepEqual(orderReportPhotos([]), []);
{
  const only = photo(3);
  assert.deepEqual(ids(orderReportPhotos([only])), [only.id]);
}
{
  const series = [photo(5, 'All'), photo(1, 'All'), photo(9, 'All')];
  const ordered = orderReportPhotos(series);
  assert.deepEqual(ids(ordered), ids([series[1], series[0], series[2]]));
}

// ---- ordering never mutates its input ----

{
  const input = [photo(9), photo(2, 'S'), photo(4, 'S')];
  const snapshot = [...input];
  orderReportPhotos(input);
  assert.deepEqual(input, snapshot);
}

console.log('report-order self-check passed');
