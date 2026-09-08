/**
 * Case-report photo ordering (pure).
 *
 * The report reads oldest-to-newest overall, but photos the clinician linked
 * into a lesion series (lesionGroup) must appear as one contiguous block —
 * a patient follows one lesion's story front to back instead of finding its
 * photos scattered through the report wherever their dates land. Each series
 * becomes a single block positioned at its earliest capture; an unlinked
 * photo is its own singleton block. Within a block, oldest first.
 *
 * Dependency-free so scripts/self-check-report-order.mjs can import it
 * straight from Node — the same discipline as photo-link.ts.
 */

/** The fields of a photo the ordering reads. */
export interface ReportOrderPhoto {
  capturedAt: Date;
  /** Series name; photos sharing it form one contiguous block. */
  lesionGroup: string | null;
}

export function orderReportPhotos<T extends ReportOrderPhoto>(photos: readonly T[]): T[] {
  // Ascending first: within-series order falls out for free, and the stable
  // block sort below breaks date ties chronologically.
  const asc = [...photos].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const series = new Map<string, T[]>();
  const blocks: { start: number; items: T[] }[] = [];
  for (const photo of asc) {
    if (!photo.lesionGroup) {
      blocks.push({ start: photo.capturedAt.getTime(), items: [photo] });
      continue;
    }
    const members = series.get(photo.lesionGroup);
    if (members) members.push(photo);
    else series.set(photo.lesionGroup, [photo]);
  }
  for (const members of series.values()) {
    blocks.push({ start: members[0].capturedAt.getTime(), items: members });
  }
  return blocks.sort((a, b) => a.start - b.start).flatMap((block) => block.items);
}
