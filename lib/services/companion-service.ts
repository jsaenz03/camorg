/**
 * Companion Service
 *
 * Shares the signed-in clinician's library with their tethered phone while a
 * phone link session is open, so the phone can review photos with the patient
 * away from the desk. The manifest mirrors exactly what the clinician can see
 * on the PC — the same patient and photo queries the desktop UI uses — and
 * photo bytes are only ever served for the explicit filename whitelist pushed
 * alongside it. The Rust shell owns no data decisions (see remote_camera.rs).
 *
 * The phone can also ask the desktop to mark a patient reviewed or prepare a
 * case report; those run through the same services the desktop UI uses (see
 * CompanionProvider for the event listeners).
 */

import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { format } from 'date-fns';
import type {
  CompanionLibrary,
  CompanionPatient,
  CompanionPhoto,
} from '@/specs/001-role-you-are/contracts/camera-service';
import { getPhotosDir } from '@/lib/db/database';
import { patientService } from '@/lib/services/patient-service';
import { photoService } from '@/lib/services/photo-service';
import { authService } from '@/lib/services/auth-service';
import { accessService } from '@/lib/services/access-service';
import { auditService } from '@/lib/services/audit-service';
import {
  consentStatus,
  reviewStatus,
  ConsentScopeLabels,
  DEFAULT_REVIEW_WARNING_DAYS,
  DEFAULT_REVIEW_STALE_DAYS,
} from '@/types/patient';
import {
  BILATERAL_BODY_PARTS,
  bodyPartDisplayLabel,
  type BodyPart,
} from '@/types/body-part';
import { formatDateOfBirth } from '@/lib/utils/date-formatting';

class CompanionService {
  /**
   * Build the manifest from the same access-filtered reads the desktop UI
   * uses: searchPatients('') returns exactly the patients this clinician can
   * see, and getAllPhotos applies the same filter. Archived patients are
   * excluded (they are hidden on the PC too).
   */
  async buildLibrary(): Promise<CompanionLibrary> {
    const [patients, photos, settings] = await Promise.all([
      patientService.searchPatients(''),
      photoService.getAllPhotos({ includeDeleted: false }),
      authService.getSettings().catch(() => null),
    ]);

    const visible = new Set(patients.map((p) => p.id));
    const warningDays = settings?.reviewWarningDays ?? DEFAULT_REVIEW_WARNING_DAYS;
    const staleDays = settings?.reviewStaleDays ?? DEFAULT_REVIEW_STALE_DAYS;

    const patientRows: CompanionPatient[] = patients.map((p) => ({
      id: p.id,
      name: p.name,
      photoCount: p.photoCount,
      lastPhotoAt: p.lastPhotoAt?.getTime() ?? null,
      consent: consentStatus(p),
      review: reviewStatus(p, { warningDays, staleDays }),
      reviewDueAt: p.reviewDueAt?.getTime() ?? null,
    }));

    const photoRows: CompanionPhoto[] = photos
      .filter((ph) => visible.has(ph.patientId))
      .map((ph) => ({
        id: ph.id,
        patientId: ph.patientId,
        bodyPart: ph.bodyPart,
        bodyPartLabel: bodyPartDisplayLabel(ph.bodyPart as BodyPart, ph.laterality),
        laterality: BILATERAL_BODY_PARTS.has(ph.bodyPart as BodyPart) ? ph.laterality : null,
        subpart: ph.subpart,
        notes: ph.clinicalNotes,
        capturedAt: ph.capturedAt.getTime(),
      }));

    return {
      viewing: true,
      generatedAt: Date.now(),
      patients: patientRows,
      photos: photoRows,
    };
  }

  /**
   * Push (or refresh) the shared library to the tether server. Safe to call
   * with no session open — the shell just holds the manifest until a server
   * starts or it is cleared.
   */
  async publish(): Promise<void> {
    const library = await this.buildLibrary();
    const photosDir = await getPhotosDir();
    // Stored photos are always <id>.jpg + <id>.thumb.jpg (photo-service), so
    // the whitelist derives straight from the manifest.
    const allowedFiles = library.photos.flatMap((p) => [`${p.id}.jpg`, `${p.id}.thumb.jpg`]);
    await invoke('update_remote_library', {
      manifestJson: JSON.stringify(library),
      photosDir,
      allowedFiles,
      allowedPatients: library.patients.map((p) => p.id),
    });
  }

  /** Drop the shared library and any staged report. */
  async unpublish(): Promise<void> {
    await invoke('clear_remote_library');
  }

  /**
   * Generate the patient's case report for the phone, exactly as the desktop
   * report page would, and stage it for download at /report. Returns the
   * page count. Access-checked; audited like any photo export.
   */
  async generateReport(patientId: string): Promise<number> {
    const patient = await patientService.getPatientById(patientId);
    if (!patient) throw new Error('Patient not found');
    if (!(await accessService.canAccessPatient(patientId))) {
      throw new Error("You don't have access to this patient.");
    }

    const [clinician, photoPaths] = await Promise.all([
      accessService.getCurrentClinician().catch(() => null),
      photoService.getActivePhotoFilePaths(patientId),
    ]);
    if (photoPaths.size === 0) throw new Error('This patient has no photos to report on.');

    const photos = await photoService.getPhotosByPatient(patientId);
    const active = photos
      .filter((ph) => photoPaths.has(ph.id))
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

    const consent = consentStatus(patient);
    const consentLabel =
      consent === 'valid'
        ? `${ConsentScopeLabels[patient.consentScope ?? 'care']}${
            patient.consentExpiresAt ? ` (expires ${format(patient.consentExpiresAt, 'dd/MM/yyyy')})` : ''
          }`
        : consent === 'expired'
          ? 'EXPIRED'
          : 'None on record';

    const savePath = await join(await appDataDir(), 'phone-report.pdf');
    const outcome = await invoke<{ pageCount: number }>('generate_case_report', {
      request: {
        savePath,
        patientName: patient.name,
        dateOfBirth: formatDateOfBirth(patient.dateOfBirth),
        treatingClinician: patient.ownerName,
        preparedBy: clinician?.displayName ?? patient.ownerName ?? 'Clinician',
        preparedAt: format(new Date(), 'dd/MM/yyyy, h:mm a'),
        consentLabel,
        consentValid: consent === 'valid',
        photoCountLabel: `${active.length} ${active.length === 1 ? 'photo' : 'photos'}`,
        timelineLabel:
          active.length > 0
            ? `${format(active[0].capturedAt, 'dd/MM/yyyy')} to ${format(
                active[active.length - 1].capturedAt,
                'dd/MM/yyyy',
              )}`
            : null,
        photos: active.map((ph) => ({
          path: photoPaths.get(ph.id),
          capturedLabel: format(ph.capturedAt, 'dd/MM/yyyy'),
          bodyPart: bodyPartDisplayLabel(ph.bodyPart, ph.laterality),
          subpart: ph.subpart,
          clinicalNotes: ph.clinicalNotes,
        })),
      },
    });

    await invoke('stage_remote_report', { path: savePath });
    void auditService.record('photo.export', {
      entityType: 'patient',
      entityId: patientId,
      patientId,
      detail: 'case report for phone link',
    });
    return outcome.pageCount;
  }
}

export const companionService = new CompanionService();

// Whether the capture screen is mounted (and therefore already handling
// remote-camera-photo events — either straight into the form or into its
// pending tray). The companion provider's global listener defers to it so a
// photo is never handled twice.
let captureScreenActive = false;

export function setCaptureScreenActive(active: boolean): void {
  captureScreenActive = active;
}

export function isCaptureScreenActive(): boolean {
  return captureScreenActive;
}
