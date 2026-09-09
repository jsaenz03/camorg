/**
 * Capture prefill resolution (pure).
 *
 * Whose details land on a photo entering the capture form, and when — the
 * two rules the flow depends on, pinned by scripts/self-check-capture-prefill.mjs:
 *
 *  1. A capture opened inside a patient file always addresses the photo to
 *     that patient — whatever entry point opened the dialog (the patient
 *     page's Capture button, the companion provider's snap auto-open) and
 *     whatever the photo itself carries. The photo's own address (a phone
 *     patient tag, a staged review follow-up) is kept only when no patient
 *     file is open (dashboard, photos page) — the snap keeps what it was
 *     taken with.
 *  2. A staged follow-up's location prefill survives only inside its own
 *     patient's file; from another patient's file the location is blank —
 *     the lesion belongs to the original's patient, and the save path
 *     already refuses cross-patient series links.
 */

import type { CaptureOptions, CapturePrefill } from '@/components/capture/capture-provider';

/** The patient a capture is addressed to: name, with optional id and dob. */
export interface PatientAddress {
  patientId?: string;
  patientName?: string;
  patientDob?: string;
}

/**
 * Fold the ambient patient (the file open beneath the dialog) into an
 * openCapture call. An explicitly addressed capture (the patient page's
 * button, a review follow-up) is complete as called; ambient fills only a
 * context-free open — the companion provider's snap auto-open — so every
 * entry point inside a patient's file carries the same address.
 */
export function mergeCaptureOptions(
  ambient: CaptureOptions | null,
  options: CaptureOptions,
): CaptureOptions {
  if (!ambient || options.patientName) return options;
  return { ...ambient, ...options };
}

/** A staged review follow-up: its original's patient and location. */
export interface FollowUpAddress extends PatientAddress {
  linkPhotoId: string;
  prefill?: CapturePrefill;
}

/**
 * Resolve the form prefill for a photo entering the capture form. The
 * dialog's patient (the file it was opened inside) wins over everything
 * the photo carries; without one, the photo keeps its own address.
 */
export function resolveCapturePrefill(sources: {
  /** The patient file the dialog was opened inside (explicit or ambient). */
  patient?: PatientAddress;
  /** The staged follow-up the photo carries, if any. */
  followUp?: FollowUpAddress | null;
  /** The patient the phone tagged the snap with, if any. */
  hint?: PatientAddress | null;
  /** Location prefill requested by the caller (a desktop review follow-up). */
  locationPrefill?: CapturePrefill;
}): { patientName: string; patientDob: string; location?: CapturePrefill } {
  const { patient, followUp, hint, locationPrefill } = sources;
  // Name and DOB are one address — they come from the same source or not at
  // all, so a dropped follow-up can never leave its DOB behind on another
  // patient's photo. The open patient file wins; outside one, the photo
  // keeps its own address (staged follow-up first, then the phone tag).
  const address = patient ?? followUp ?? hint;
  // Both ids known and different: the follow-up belongs to another
  // patient's lesion — its location must not smear onto this patient's photo.
  const crossPatient =
    !!patient?.patientId && !!followUp?.patientId && patient.patientId !== followUp.patientId;
  const location = crossPatient ? undefined : followUp?.prefill ?? locationPrefill;
  return {
    patientName: address?.patientName ?? '',
    patientDob: address?.patientDob ?? '',
    ...(location ? { location } : {}),
  };
}
