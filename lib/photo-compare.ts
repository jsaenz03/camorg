import type { PhotoRecord } from '@/types/photo';

/**
 * Seed picks for a two-pane comparison. Pools are newest-first (as the
 * photo service returns them). Each side starts on its pool's newest
 * photo; when both pools resolve to the same capture — the within-patient
 * before/after case — the right side falls back to the next newest so the
 * panes never open on the identical image.
 */
export function defaultComparePicks(
  leftPool: PhotoRecord[],
  rightPool: PhotoRecord[],
): { leftId: string | null; rightId: string | null } {
  const leftId = leftPool[0]?.id ?? null;
  return { leftId, rightId: rightPool.find((p) => p.id !== leftId)?.id ?? null };
}

/**
 * Lesion-series filtering for the compare surfaces. A "linkage" is a lesion
 * series (lesionGroup): photos sharing one on the same patient are a linked
 * before/after chain. The two filters cascade — picking a series leaves only
 * the body parts that series covers, picking a part leaves only the series
 * under that part — so the pools and the dropdown choices prune together.
 *
 * Kept import-free (structural photos) so scripts/self-check-compare.mjs can
 * load this module straight from Node.
 */

/** Structural minimum the filters need from a photo record. */
export interface FilterablePhoto {
  bodyPart: string;
  lesionGroup: string | null;
}

export type ComparePartFilter = string | 'all';
export type CompareSeriesFilter = string | 'all';

/**
 * Body parts that still have photos under the current series filter — the
 * part dropdown's pruned choices.
 */
export function comparePartOptions(
  photos: FilterablePhoto[],
  series: CompareSeriesFilter,
): string[] {
  const parts = new Set<string>();
  for (const p of photos) {
    if (series === 'all' || p.lesionGroup === series) parts.add(p.bodyPart);
  }
  return [...parts];
}

/**
 * Lesion series that still have photos under the current part filter — the
 * linkage dropdown's pruned choices. Photos without a series never appear.
 */
export function compareSeriesOptions(
  photos: FilterablePhoto[],
  part: ComparePartFilter,
): string[] {
  const groups = new Set<string>();
  for (const p of photos) {
    if (part !== 'all' && p.bodyPart !== part) continue;
    if (p.lesionGroup) groups.add(p.lesionGroup);
  }
  return [...groups].sort((a, b) => a.localeCompare(b));
}

/** A photo survives both filters — the pane pool after pruning. */
export function filterComparePool<P extends FilterablePhoto>(
  photos: P[],
  part: ComparePartFilter,
  series: CompareSeriesFilter,
): P[] {
  return photos.filter(
    (p) =>
      (part === 'all' || p.bodyPart === part) &&
      (series === 'all' || p.lesionGroup === series),
  );
}

/**
 * Drop filters the pool can no longer support (patient switched on the
 * Compare page, series renamed away) instead of silently emptying the panes.
 */
export function resolveCompareFilters(
  photos: FilterablePhoto[],
  part: ComparePartFilter,
  series: CompareSeriesFilter,
): { part: ComparePartFilter; series: CompareSeriesFilter } {
  const nextPart =
    part !== 'all' && comparePartOptions(photos, 'all').includes(part) ? part : 'all';
  const nextSeries =
    series !== 'all' && compareSeriesOptions(photos, 'all').includes(series)
      ? series
      : 'all';
  return { part: nextPart, series: nextSeries };
}

/** Which comparison pane a gesture targets. */
export type CompareSide = 'left' | 'right';

/** Per-pane viewport: zoom factor and translate offset in px. */
export interface CompareTransform {
  zoom: number;
  offset: { x: number; y: number };
}

export const DEFAULT_COMPARE_TRANSFORM: CompareTransform = {
  zoom: 1,
  offset: { x: 0, y: 0 },
};

export const MIN_COMPARE_ZOOM = 1;
export const MAX_COMPARE_ZOOM = 8;

/** Zoom step per button press (wheel uses a finer step inline). */
export const COMPARE_ZOOM_STEP = 1.25;

export type CompareTransforms = Record<CompareSide, CompareTransform>;

function clampZoom(zoom: number): number {
  return Math.min(MAX_COMPARE_ZOOM, Math.max(MIN_COMPARE_ZOOM, zoom));
}

/** Pan: translate by a pointer delta; zoom unchanged. */
export function panTransform(start: CompareTransform, dx: number, dy: number): CompareTransform {
  return { zoom: start.zoom, offset: { x: start.offset.x + dx, y: start.offset.y + dy } };
}

/** Zoom: multiply by a factor around the image centre, clamped; offset unchanged. */
export function zoomTransform(t: CompareTransform, factor: number): CompareTransform {
  return { ...t, zoom: clampZoom(t.zoom * factor) };
}

function mapSides(
  start: CompareTransforms,
  move: (t: CompareTransform) => CompareTransform,
  anchored: boolean,
  side: CompareSide,
): CompareTransforms {
  if (anchored) return { left: move(start.left), right: move(start.right) };
  const next: CompareTransforms = { ...start };
  next[side] = move(start[side]);
  return next;
}

/**
 * Apply a pan gesture to both pane transforms. When anchored, each pane
 * moves by the same delta from its own gesture-start transform — so
 * panning keeps each pane's zoom, and re-anchoring after free movement
 * simply means the next gesture moves them together from where they are.
 */
export function applyPan(
  start: CompareTransforms,
  dx: number,
  dy: number,
  anchored: boolean,
  side: CompareSide,
): CompareTransforms {
  return mapSides(start, (t) => panTransform(t, dx, dy), anchored, side);
}

/** Apply a zoom gesture (factor around the image centre), same anchor rules. */
export function applyZoom(
  start: CompareTransforms,
  factor: number,
  anchored: boolean,
  side: CompareSide,
): CompareTransforms {
  return mapSides(start, (t) => zoomTransform(t, factor), anchored, side);
}
