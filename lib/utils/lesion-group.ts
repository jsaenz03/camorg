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
