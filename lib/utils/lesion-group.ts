/**
 * Lesion series name handling (migration 013).
 *
 * Kept dependency-free so scripts/self-check-lesion-groups.mjs can import
 * it straight from Node and pin the stored form of a series name.
 */

/**
 * Normalise a lesion series name: trim, collapse internal whitespace,
 * cap at 100 chars (the same limit the update schema enforces). Returns
 * null for blank input = "not in a series". Pure so the form, the service
 * and the self-check all agree on what a stored group name looks like —
 * otherwise a stray space fragments "Left cheek mole" into two groups.
 */
export function normalizeLesionGroup(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  return normalized.length > 0 ? normalized : null;
}

// Month abbreviations for reviewSeriesName's date suffix, hand-rolled so
// this module stays dependency-free for the Node self-check.
const MONTH_ABBRS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Series name for a review follow-up anchored to the original photo:
 * "<body part> (<subpart>) — from <original capture date>". Sharing a series
 * is how a follow-up links to its original, so when the original has no
 * series yet this names one a clinician can still recognise later. The date
 * keeps it effectively unique among the patient's other series.
 */
export function reviewSeriesName(original: {
  bodyPartLabel: string;
  subpart?: string | null;
  capturedAt: Date;
}): string {
  const { bodyPartLabel, subpart, capturedAt } = original;
  const name = normalizeLesionGroup(
    `${bodyPartLabel}${subpart ? ` (${subpart})` : ''} — from ` +
      `${capturedAt.getDate()} ${MONTH_ABBRS[capturedAt.getMonth()]} ${capturedAt.getFullYear()}`,
  );
  return name ?? 'Review series';
}
