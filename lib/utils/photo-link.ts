/**
 * Drag-to-link/unlink decision (pure).
 *
 * What happens when one photo tile is dropped onto another, pinned by
 * scripts/self-check-photo-link.mjs. Kept dependency-free so the self-check
 * can import it straight from Node — the same discipline as lesion-group.ts
 * and capture-prefill.ts.
 *
 * Linking = both photos share a lesion series (lesionGroup). When the target
 * already has one, the dragged photo files into it (dropping A onto B reads
 * as "put A with B"); when only the dragged photo has one, the target joins
 * that. When neither has one the plan carries no name and the caller supplies
 * one (the dialog pre-fills reviewSeriesName for the dragged photo). Only the
 * dropped pair is touched: a photo moving between series leaves its old
 * series' other members alone.
 *
 * The inverse gesture: dropping a photo onto another tile from its OWN series
 * unlinks it (the two are already linked, so the drop reads as "pull this one
 * out"). Whether the whole series dissolves with it depends on how many
 * members remain — resolveUnlinkScope, decided where the member list is
 * fetched (the confirm dialog).
 */

/** The fields of a photo the link decision reads. */
export interface LinkablePhoto {
  id: string;
  patientId: string;
  /** Series name; photos sharing it on the same patient form a series. */
  lesionGroup: string | null;
  isDeleted: boolean;
}

export type PhotoLinkPlan =
  | {
      ok: true;
      action: 'link';
      /** Series to apply; null = neither photo has a name yet, caller supplies one. */
      seriesName: string | null;
      /** Photos that need an updatePhoto — already-correct ones are excluded. */
      photoIds: string[];
    }
  | {
      ok: true;
      action: 'unlink';
      /** The series the dragged photo is being pulled out of. */
      seriesName: string;
      /** Starts as just the dragged photo; the dialog may widen it to dissolve. */
      photoIds: string[];
    }
  | { ok: false; reason: 'same-photo' | 'cross-patient' | 'deleted' };

export function resolvePhotoLink(
  source: LinkablePhoto,
  target: LinkablePhoto,
): PhotoLinkPlan {
  if (source.id === target.id) return { ok: false, reason: 'same-photo' };
  // A series belongs to one patient's lesion — save refuses cross-patient
  // links, so the drop refuses before a dialog ever opens.
  if (source.patientId !== target.patientId) {
    return { ok: false, reason: 'cross-patient' };
  }
  if (source.isDeleted || target.isDeleted) return { ok: false, reason: 'deleted' };

  // Both already share a series: the drop unlinks the dragged photo.
  if (
    source.lesionGroup !== null &&
    target.lesionGroup !== null &&
    source.lesionGroup === target.lesionGroup
  ) {
    return { ok: true, action: 'unlink', seriesName: source.lesionGroup, photoIds: [source.id] };
  }

  const seriesName = target.lesionGroup ?? source.lesionGroup;
  // No name yet: both photos need the caller-supplied one, whatever their
  // (matching null) stored value says.
  const needsUpdate = (photo: LinkablePhoto) =>
    seriesName === null || photo.lesionGroup !== seriesName;
  const photoIds = [source, target].filter(needsUpdate).map((photo) => photo.id);
  return { ok: true, action: 'link', seriesName, photoIds };
}

/**
 * Which photos leave the series when one photo is unlinked from it. A series
 * that would drop to a single member is a name with nothing linked to it, so
 * the whole series dissolves instead (every remaining member is cleared too).
 * Pure so the dialog's dissolve decision is pinned by the same self-check.
 */
export function resolveUnlinkScope(
  memberIds: string[],
  leavingId: string,
): { photoIds: string[]; dissolve: boolean } {
  const rest = memberIds.filter((id) => id !== leavingId);
  if (rest.length <= 1) {
    return { photoIds: [leavingId, ...rest], dissolve: true };
  }
  return { photoIds: [leavingId], dissolve: false };
}
