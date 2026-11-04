// Self-check for the shared timeline filter (lib/utils/timeline-filter.ts).
//
// Run: node scripts/self-check-timeline-filter.mjs
//
// Pins the one reduction the timeline grid and the case report both go
// through — the report (and its print) must cover exactly the photos the
// grid was showing:
//  - a series filter keeps only that series (series-only view → series-only
//    print-out);
//  - body part, attachment presence and calendar-day filters hold;
//  - filters combine (AND) and an all-off filter is the identity;
//  - day matching is calendar-day, not 24-hours;
//  - the input is never mutated.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import {
  applyTimelineFilter,
  isFilterActive,
  ALL_TIMELINE_FILTER,
} from '../lib/utils/timeline-filter.ts';

let seq = 0;
function photo({ day = 1, hour = 9, bodyPart = null, lesionGroup = null, attachments = 0 }) {
  seq += 1;
  return {
    id: `photo-${seq}`,
    capturedAt: new Date(2026, 0, day, hour, 0, 0),
    bodyPart,
    lesionGroup,
    attachmentCount: attachments,
  };
}
const ids = (photos) => photos.map((p) => p.id);

// ---- a series filter keeps only that series (the headline report case) ----

{
  const hand = [photo({ lesionGroup: 'Left hand' }), photo({ lesionGroup: 'Left hand' })];
  const back = photo({ lesionGroup: null });
  const other = photo({ lesionGroup: 'Right cheek' });
  const filtered = applyTimelineFilter([back, ...hand, other], {
    ...ALL_TIMELINE_FILTER,
    series: 'Left hand',
  });
  assert.deepEqual(ids(filtered), ids(hand), 'series filter must keep only that series');
}

// ---- the "not in a series" filter keeps only unlinked photos ----

{
  const hand = [photo({ lesionGroup: 'Left hand' }), photo({ lesionGroup: 'Left hand' })];
  const unlinkedA = photo({ lesionGroup: null });
  const unlinkedB = photo({ lesionGroup: null });
  const filtered = applyTimelineFilter([...hand, unlinkedA, unlinkedB], {
    ...ALL_TIMELINE_FILTER,
    unlinked: true,
  });
  assert.deepEqual(ids(filtered), [unlinkedA.id, unlinkedB.id]);
  // A named-series filter and the unlinked filter are different views of the
  // same axis: the unlinked flag must not drag a named filter's photos in.
  const both = applyTimelineFilter([...hand, unlinkedA], {
    ...ALL_TIMELINE_FILTER,
    series: 'Left hand',
    unlinked: true,
  });
  assert.deepEqual(ids(both), [], 'series + unlinked together match nothing');
  assert.equal(isFilterActive({ ...ALL_TIMELINE_FILTER, unlinked: true }), true);
}

// ---- body part filter ----

{
  const face = photo({ bodyPart: 'face' });
  const arm = photo({ bodyPart: 'hand' });
  const none = photo({ bodyPart: null });
  const filtered = applyTimelineFilter([face, arm, none], {
    ...ALL_TIMELINE_FILTER,
    bodyPart: 'face',
  });
  assert.deepEqual(ids(filtered), [face.id], 'body-part filter keeps only that part');
  // "Unspecified" photos belong to no part — a part filter excludes them.
  const unspecified = applyTimelineFilter([face, arm, none], {
    ...ALL_TIMELINE_FILTER,
    bodyPart: 'back',
  });
  assert.deepEqual(ids(unspecified), [], 'non-matching part excludes everything else');
}

// ---- attachment presence ----

{
  const withFile = photo({ attachments: 2 });
  const withoutFile = photo({ attachments: 0 });
  const withOnly = applyTimelineFilter([withFile, withoutFile], {
    ...ALL_TIMELINE_FILTER,
    attachments: 'with',
  });
  assert.deepEqual(ids(withOnly), [withFile.id]);
  const withoutOnly = applyTimelineFilter([withFile, withoutFile], {
    ...ALL_TIMELINE_FILTER,
    attachments: 'without',
  });
  assert.deepEqual(ids(withoutOnly), [withoutFile.id]);
}

// ---- calendar-day matching, not 24-hours ----

{
  // 23:00 on 5 Jan and 01:00 on 5 Jan are the same day; 00:30 on 6 Jan is
  // 1.5h from the 23:00 capture but a different calendar day.
  const evening = photo({ day: 5, hour: 23 });
  const morning = photo({ day: 5, hour: 1 });
  const nextDawn = photo({ day: 6, hour: 0 });
  const filtered = applyTimelineFilter([evening, morning, nextDawn], {
    ...ALL_TIMELINE_FILTER,
    date: new Date(2026, 0, 5),
  });
  assert.deepEqual(ids(filtered), [evening.id, morning.id]);
}

// ---- filters combine (AND) ----

{
  const hit = photo({ bodyPart: 'face', lesionGroup: 'Mole', attachments: 1 });
  const wrongSeries = photo({ bodyPart: 'face', lesionGroup: 'Other', attachments: 1 });
  const wrongPart = photo({ bodyPart: 'back', lesionGroup: 'Mole', attachments: 1 });
  const noFile = photo({ bodyPart: 'face', lesionGroup: 'Mole', attachments: 0 });
  const filtered = applyTimelineFilter([hit, wrongSeries, wrongPart, noFile], {
    bodyPart: 'face',
    series: 'Mole',
    attachments: 'with',
    date: null,
  });
  assert.deepEqual(ids(filtered), [hit.id]);
}

// ---- an all-off filter is the identity ----

{
  const set = [
    photo({ bodyPart: 'face', lesionGroup: 'Mole' }),
    photo({ attachments: 3 }),
    photo({ day: 12 }),
  ];
  assert.deepEqual(applyTimelineFilter(set, ALL_TIMELINE_FILTER), set);
  assert.equal(isFilterActive(ALL_TIMELINE_FILTER), false);
}

// ---- isFilterActive mirrors every axis ----

assert.equal(isFilterActive({ ...ALL_TIMELINE_FILTER, series: 'S' }), true);
assert.equal(isFilterActive({ ...ALL_TIMELINE_FILTER, bodyPart: 'face' }), true);
assert.equal(isFilterActive({ ...ALL_TIMELINE_FILTER, attachments: 'without' }), true);
assert.equal(isFilterActive({ ...ALL_TIMELINE_FILTER, date: new Date() }), true);

// ---- ordering never mutates its input ----

{
  const input = [photo({ lesionGroup: 'S' }), photo({ bodyPart: 'face' })];
  const snapshot = [...input];
  applyTimelineFilter(input, { ...ALL_TIMELINE_FILTER, series: 'S' });
  assert.deepEqual(input, snapshot);
}

console.log('timeline-filter self-check passed');
