/**
 * Box (rubber-band) select geometry — the pure half of PhotoBento's
 * Ctrl-drag selection: the band rectangle swept between a press point and
 * the live pointer, and the tile-vs-band intersection test. Keep this file
 * free of DOM/React so scripts/self-check-box-select.mjs can pin the maths.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The axis-aligned band swept between two viewport points (a press and the
 * live pointer). Dragging "backwards" (up-left) still yields a rect with a
 * positive size.
 */
export function marqueeRect(
  startX: number,
  startY: number,
  x: number,
  y: number,
): Rect {
  return {
    left: Math.min(startX, x),
    top: Math.min(startY, y),
    width: Math.abs(x - startX),
    height: Math.abs(y - startY),
  };
}

/** Two rects sharing at least one square pixel hit; merely touching edges
    share no area, so they don't. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * The selection delta a band move announces: tiles inside the band that the
 * last announcement missed (to select), and tiles announced last time that
 * the band has now left (to restore — back to their pre-drag selection, only
 * entries the band itself added are swept back out).
 */
export function marqueeDelta(options: {
  inBandIds: string[];
  announced: ReadonlySet<string>;
}): { gained: string[]; lost: string[] } {
  const inBand = new Set(options.inBandIds);
  const gained: string[] = [];
  for (const id of options.inBandIds) {
    if (!options.announced.has(id)) gained.push(id);
  }
  const lost: string[] = [];
  for (const id of options.announced) {
    if (!inBand.has(id)) lost.push(id);
  }
  return { gained, lost };
}
