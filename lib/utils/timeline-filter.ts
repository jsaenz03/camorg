/**
 * Shared timeline filtering.
 *
 * The case report must follow what the clinician filtered on the patient's
 * timeline (the Report button carries the active filter to /patients/report
 * as query params — print/save/email all render whatever the report loaded),
 * so both places reduce photo records through this one function and a
 * print-out can never disagree with the grid it was filtered from.
 */

import type { BodyPart } from '@/types/body-part';

export interface TimelineFilter {
  /** Lesion series name; null = all series. */
  series: string | null;
  /** Only photos that belong to no lesion series ("not in a series"
      option). Mutually exclusive with `series` by construction. */
  unlinked: boolean;
  /** Body-part enum key; null = all body parts. */
  bodyPart: BodyPart | null;
  /** Attachment presence; 'all' = no constraint. */
  attachments: 'all' | 'with' | 'without';
  /** Calendar-day filter; null = any day. */
  date: Date | null;
}

export const ALL_TIMELINE_FILTER: TimelineFilter = {
  series: null,
  unlinked: false,
  bodyPart: null,
  attachments: 'all',
  date: null,
};

export function isFilterActive(filter: TimelineFilter): boolean {
  return (
    filter.series !== null ||
    filter.unlinked ||
    filter.bodyPart !== null ||
    filter.attachments !== 'all' ||
    filter.date !== null
  );
}

/** Local-midnight day equality (the timeline's own filter semantics). */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The one reduction both the timeline grid and the report go through. */
export function applyTimelineFilter<
  Photo extends {
    bodyPart: string | null;
    lesionGroup: string | null;
    attachmentCount: number;
    capturedAt: Date;
  },
>(photos: Photo[], filter: TimelineFilter): Photo[] {
  return photos.filter((photo) => {
    if (filter.bodyPart !== null && photo.bodyPart !== filter.bodyPart) return false;
    if (filter.series !== null && photo.lesionGroup !== filter.series) return false;
    if (filter.unlinked && photo.lesionGroup !== null) return false;
    if (
      filter.attachments !== 'all' &&
      (photo.attachmentCount > 0) !== (filter.attachments === 'with')
    ) {
      return false;
    }
    if (filter.date && !isSameLocalDay(photo.capturedAt, filter.date)) return false;
    return true;
  });
}
