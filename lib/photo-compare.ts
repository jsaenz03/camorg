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
