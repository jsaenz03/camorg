/**
 * Capture-draft persistence (sessionStorage).
 *
 * A just-captured photo lives only in React state until the metadata form is
 * saved; an accidental navigation during that window used to destroy the only
 * copy. These helpers mirror the photo into sessionStorage so the capture
 * page can restore it on next mount, and clear it once saved or discarded.
 *
 * ponytail: sessionStorage (≈5MB per origin) holds one compressed JPEG
 * data-URL; an oversize draft is dropped rather than stored — a multi-photo
 * scratchpad would need disk-backed storage.
 */

import type { CapturedPhoto } from '@/specs/001-role-you-are/contracts/camera-service';

const DRAFT_KEY = 'camog.captureDraft';
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

export interface CaptureDraft {
  dataUrl: string;
  width: number;
  height: number;
  /** unix ms */
  capturedAt: number;
  /** unix ms — drafts older than a day are stale, not restorable */
  savedAt: number;
}

export function saveCaptureDraft(photo: CapturedPhoto): boolean {
  if (typeof window === 'undefined') return false;
  const draft: CaptureDraft = {
    dataUrl: photo.dataUrl,
    width: photo.width,
    height: photo.height,
    capturedAt: photo.capturedAt.getTime(),
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false; // quota exceeded — capture works, just unprotected
  }
}

export function readCaptureDraft(nowMs = Date.now()): CaptureDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<CaptureDraft>;
    if (typeof d?.dataUrl !== 'string' || typeof d.capturedAt !== 'number') return null;
    const savedAt = typeof d.savedAt === 'number' ? d.savedAt : 0;
    if (nowMs - savedAt > MAX_DRAFT_AGE_MS) {
      clearCaptureDraft();
      return null;
    }
    return {
      dataUrl: d.dataUrl,
      width: typeof d.width === 'number' ? d.width : 0,
      height: typeof d.height === 'number' ? d.height : 0,
      capturedAt: d.capturedAt,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function clearCaptureDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // already absent / storage unavailable
  }
}

/** Rebuild a CapturedPhoto from a stored draft (fetch decodes the data URL). */
export async function draftToCapturedPhoto(draft: CaptureDraft): Promise<CapturedPhoto> {
  const blob = await (await fetch(draft.dataUrl)).blob();
  return {
    blob,
    dataUrl: draft.dataUrl,
    width: draft.width,
    height: draft.height,
    capturedAt: new Date(draft.capturedAt),
  };
}
