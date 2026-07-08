/**
 * A per-patient doctor grant — the "specific doctors" sharing mode.
 *
 * A row here means the named clinician can view (and capture into) the patient
 * regardless of ownership. Mutually exclusive in spirit with patient.is_org_shared:
 * the admin UI toggles between the two modes, but both being true is harmless
 * (the OR-based visibility rule still holds).
 */
export interface PatientShare {
  id: string; // UUID v4
  patientId: string;
  clinicianId: string;
  grantedBy: string; // admin clinician id
  grantedAt: Date;
}
