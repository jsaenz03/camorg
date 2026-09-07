/**
 * Self-check for the customisable dashboard's pure logic
 * (lib/dashboard-widgets.ts): the stored-preference resolver (default,
 * custom order, unknown/duplicate ids, emptied dashboard), the drag
 * reorder move, and the add-widget picker's hidden-widget list.
 *
 * Run: node scripts/self-check-dashboard-layout.mjs
 *
 * Fails loudly (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import {
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD_WIDGETS,
  hiddenDashboardWidgets,
  moveWidget,
  resolveDashboardWidgets,
} from '../lib/dashboard-widgets.ts';

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

// Default layout = registry order, one entry per widget, spans in range.
assert.equal(DEFAULT_DASHBOARD_WIDGETS.length, DASHBOARD_WIDGETS.length);
assert.equal(
  new Set(DEFAULT_DASHBOARD_WIDGETS).size,
  DEFAULT_DASHBOARD_WIDGETS.length,
);
for (const w of DASHBOARD_WIDGETS) {
  assert.ok(w.span === 1 || w.span === 2 || w.span === 3, `bad span on ${w.id}`);
  assert.ok(w.label.length > 0, `missing label on ${w.id}`);
}

// ---------------------------------------------------------------------------
// resolveDashboardWidgets — stored preference → render order
// ---------------------------------------------------------------------------

// Never customised (null/undefined) → the default layout.
assert.deepEqual(resolveDashboardWidgets(null), DEFAULT_DASHBOARD_WIDGETS);
assert.deepEqual(resolveDashboardWidgets(undefined), DEFAULT_DASHBOARD_WIDGETS);

// A custom order is preserved as-is.
assert.deepEqual(resolveDashboardWidgets(['calendar', 'stats']), ['calendar', 'stats']);

// Unknown ids (from a newer app version) and duplicates are dropped.
assert.deepEqual(
  resolveDashboardWidgets(['stats', 'bogus', 'stats', 'calendar']),
  ['stats', 'calendar'],
);

// An empty custom list means "user removed every widget" — stays empty so
// the canvas can offer restore, NOT silently re-defaulted.
assert.deepEqual(resolveDashboardWidgets([]), []);

// ---------------------------------------------------------------------------
// moveWidget — drag reorder
// ---------------------------------------------------------------------------

assert.deepEqual(moveWidget(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
assert.deepEqual(moveWidget(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
assert.deepEqual(moveWidget(['a', 'b', 'c', 'd'], 1, 2), ['a', 'c', 'b', 'd']);
assert.deepEqual(moveWidget(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);

// Out-of-range or no-op indices return the list unchanged.
assert.deepEqual(moveWidget(['a'], 0, 3), ['a']);
assert.deepEqual(moveWidget(['a'], -1, 0), ['a']);
assert.deepEqual(moveWidget([], 0, 0), []);

// The input list is never mutated.
const input = ['a', 'b', 'c'];
moveWidget(input, 0, 2);
assert.deepEqual(input, ['a', 'b', 'c']);

// ---------------------------------------------------------------------------
// hiddenDashboardWidgets — the add-widget picker
// ---------------------------------------------------------------------------

assert.deepEqual(hiddenDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS), []);

const hidden = hiddenDashboardWidgets(['stats']);
assert.equal(hidden.length, DASHBOARD_WIDGETS.length - 1);
assert.ok(!hidden.some((w) => w.id === 'stats'));

assert.deepEqual(
  hiddenDashboardWidgets([]).map((w) => w.id),
  DEFAULT_DASHBOARD_WIDGETS,
);

console.log('self-check-dashboard-layout: all invariants hold');
