// Self-check for the body-map picker highlight logic
// (components/patient/body-map-picker.tsx).
// Run: node scripts/self-check-body-map.mjs
// ponytail: mirrors regionId/isSelected and the bilateral geometry because
// Node cannot import the TS/React module graph directly; if you change the
// picker's regions or selection logic, update the mirror here. Upgrade path:
// run via tsx/ts-node in CI.

import assert from 'node:assert/strict';

function regionId(part, kind, props) {
  const mid = kind === 'ellipse' ? Number(props.cx) : Number(props.x) + Number(props.width) / 2;
  const side = mid < 100 ? 'left' : mid > 100 ? 'right' : 'center';
  return `${part}-${side}`;
}

// isSelected as shipped: a value matching the part highlights it, narrowed to
// the picked side once the user has clicked a region of that part.
function isSelected(value, picked, part, key) {
  return value === part && (picked?.part !== part || picked.key === key);
}

// Bilateral geometry copied from FRONT/BACK — each pair must derive distinct
// ids, otherwise both shapes share an id and both highlight again.
const BILATERAL = [
  ['upper_arm', 'rect', { x: 48, width: 20 }, { x: 132, width: 20 }],
  ['forearm', 'rect', { x: 46, width: 18 }, { x: 136, width: 18 }],
  ['hand', 'ellipse', { cx: 55 }, { cx: 145 }],
  ['thigh', 'rect', { x: 78, width: 20 }, { x: 102, width: 20 }],
  ['leg', 'rect', { x: 78, width: 18 }, { x: 104, width: 18 }],
  ['foot', 'ellipse', { cx: 84 }, { cx: 116 }],
];
for (const [part, kind, a, b] of BILATERAL) {
  assert.notEqual(regionId(part, kind, a), regionId(part, kind, b), `${part} pair must derive distinct ids`);
}

// Central regions derive '-center' (single shape, nothing bilateral).
assert.equal(regionId('neck', 'rect', { x: 90, width: 20 }), 'neck-center');
assert.equal(regionId('head', 'ellipse', { cx: 100 }), 'head-center');

// Click one of a bilateral pair → only that side highlights.
const leftHand = regionId('hand', 'ellipse', { cx: 55 });
const rightHand = regionId('hand', 'ellipse', { cx: 145 });
const pickedLeftHand = { part: 'hand', key: leftHand };
assert.equal(isSelected('hand', pickedLeftHand, 'hand', leftHand), true);
assert.equal(isSelected('hand', pickedLeftHand, 'hand', rightHand), false);

// View switch: same geometry in BACK → same id, highlight follows the side.
const backLeftThigh = regionId('thigh', 'rect', { x: 78, width: 20 });
const pickedThigh = { part: 'thigh', key: backLeftThigh };
assert.equal(isSelected('thigh', pickedThigh, 'thigh', regionId('thigh', 'rect', { x: 78, width: 20 })), true);
assert.equal(isSelected('thigh', pickedThigh, 'thigh', regionId('thigh', 'rect', { x: 102, width: 20 })), false);

// Value from the form (no click yet) → both regions of the part highlight.
assert.equal(isSelected('hand', null, 'hand', leftHand), true);
assert.equal(isSelected('hand', null, 'hand', rightHand), true);

// Value changed elsewhere (dropdown) → stale pick for another part doesn't
// suppress the new part's highlight.
assert.equal(isSelected('foot', pickedLeftHand, 'foot', regionId('foot', 'ellipse', { cx: 84 })), true);
assert.equal(isSelected('foot', pickedLeftHand, 'foot', regionId('foot', 'ellipse', { cx: 116 })), true);

// Unselected parts never highlight.
assert.equal(isSelected('chest', pickedLeftHand, 'hand', leftHand), false);

console.log('self-check-body-map: all assertions passed');
