import { z } from 'zod';
import { BodyPart } from '@/types/body-part';
import type { ClinicianRole } from '@/types/clinician';

const passcodeRules = z
  .string()
  .min(8, 'Passcode must be at least 8 characters')
  .max(100, 'Passcode must be 100 characters or less')
  .regex(/[a-zA-Z]/, 'Passcode must contain at least one letter')
  .regex(/[0-9]/, 'Passcode must contain at least one number');

/**
 * PhotoRecord validation schemas
 */
export const photoRecordCreateSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  imageBlob: z.instanceof(Blob).refine(
    (blob) => blob.size > 0 && blob.size <= 20 * 1024 * 1024,
    { message: 'Photo must be between 0 and 20MB' }
  ),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp'], {
    message: 'Invalid image format. Supported: JPEG, PNG, HEIC, WebP',
  }),
  bodyPart: z.nativeEnum(BodyPart, {
    message: 'Please select a body part',
  }),
  subpart: z.string().max(100, 'Subpart must be 100 characters or less').optional().nullable(),
  clinicalNotes: z.string().max(2000, 'Clinical notes must be 2000 characters or less').optional().nullable(),
  capturedAt: z.date().refine((d) => d.getTime() <= Date.now(), 'Capture date cannot be in the future'),
});

export const photoRecordUpdateSchema = z.object({
  subpart: z.string().max(100, 'Subpart must be 100 characters or less').optional().nullable(),
  clinicalNotes: z.string().max(2000, 'Clinical notes must be 2000 characters or less').optional().nullable(),
});

export type PhotoRecordCreate = z.infer<typeof photoRecordCreateSchema>;
export type PhotoRecordUpdate = z.infer<typeof photoRecordUpdateSchema>;

/**
 * Patient validation schemas
 */
const dateOfBirthSchema = z
  .date('Enter a valid date of birth')
  .refine((d) => d.getTime() <= Date.now(), 'Date of birth cannot be in the future')
  .refine((d) => d.getTime() >= new Date('1900-01-01').getTime(), 'Date of birth looks too far in the past')
  .nullable();

/** Photo-consent block on patient updates. givenAt null = no consent recorded. */
export const consentSchema = z.object({
  givenAt: z.date().nullable(),
  scope: z.enum(['care', 'education', 'research']).nullable(),
  // Expiry may legitimately be in the past: an expired consent is a state
  // the UI surfaces (badge + capture warning), not an invalid one —
  // requiring a future date blocked saving unrelated edits to a patient
  // whose consent had lapsed.
  expiresAt: z.date().nullable(),
}).refine(
  (c) => c.givenAt === null || c.scope !== null,
  { message: 'Choose a consent scope', path: ['scope'] },
);

export type ConsentInput = z.infer<typeof consentSchema>;

export const patientCreateSchema = z.object({
  name: z.string().min(1, 'Patient name is required').max(100, 'Patient name must be 100 characters or less').trim(),
  dateOfBirth: dateOfBirthSchema.optional(), // optional: DOB is never required
});

export const patientUpdateSchema = z.object({
  name: z.string().min(1, 'Patient name is required').max(100, 'Patient name must be 100 characters or less').trim(),
  // Explicit, no .default(): an omitted dateOfBirth must fail validation
  // rather than silently clear the stored DOB. Callers pass null to clear.
  dateOfBirth: dateOfBirthSchema,
  consent: consentSchema,
});

export type PatientCreate = z.infer<typeof patientCreateSchema>;
export type PatientUpdate = z.infer<typeof patientUpdateSchema>;

/**
 * Clinician validation schemas
 */
export const clinicianRegisterSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be 50 characters or less')
    .trim()
    .toLowerCase(),
  passcode: passcodeRules,
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less')
    .trim(),
  inviteToken: z.string().trim().optional(),
});

export const clinicianLoginSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(50, 'Username must be 50 characters or less')
    .trim()
    .toLowerCase(),
  passcode: z.string().min(1, 'Passcode is required'),
  /** Keep me signed in: persist the session across app restarts. */
  rememberMe: z.boolean().optional(),
  /** Remember sign-in details: prefill username + passcode on this device. */
  rememberLogin: z.boolean().optional(),
});

export const changePasscodeSchema = z
  .object({
    currentPasscode: z.string().min(1, 'Current passcode is required'),
    newPasscode: passcodeRules,
    confirmPasscode: z.string().min(1, 'Please confirm your new passcode'),
  })
  .refine((d) => d.newPasscode === d.confirmPasscode, {
    message: 'Passcodes do not match',
    path: ['confirmPasscode'],
  });

export const invitationCreateSchema = z.object({
  kind: z.enum(['token', 'precreated']),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be 50 characters or less')
    .trim()
    .toLowerCase(),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less')
    .trim(),
  role: z.enum(['admin', 'clinician']),
  tempPasscode: passcodeRules.optional(),
  ttlDays: z.number().int().min(1).max(90),
});

export const invitationAcceptSchema = z.object({
  token: z.string().min(1, 'Invite code is required').trim(),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be 50 characters or less')
    .trim()
    .toLowerCase(),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less')
    .trim(),
  passcode: passcodeRules,
});

export const settingsUpdateSchema = z.object({
  sessionTimeoutMs: z.number().int().min(60_000).max(86_400_000).optional(),
  allowPublicSignup: z.boolean().optional(),
  orgName: z.string().min(1).max(100).trim().optional(),
  /** Idle privacy lock: 0 disables, otherwise 1 min – 1 hour. */
  idleLockTimeoutMs: z.number().int().min(0).max(3_600_000).optional(),
});

/**
 * Absolute filesystem path for the photos storage directory (local or a
 * cloud-synced folder). Drive-letter or POSIX root required — relative paths
 * would resolve differently per working directory.
 */
export const photosDirSchema = z
  .string()
  .min(1, 'Choose a folder for photo storage')
  .max(1024)
  .refine(
    (p) => p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p),
    'Enter an absolute folder path'
  );

export const setUserRoleSchema = z.object({
  role: z.enum(['admin', 'clinician'] as const satisfies ClinicianRole[]),
});

export type ClinicianRegister = z.infer<typeof clinicianRegisterSchema>;
export type ClinicianLogin = z.infer<typeof clinicianLoginSchema>;
export type ChangePasscode = z.infer<typeof changePasscodeSchema>;
export type InvitationCreate = z.infer<typeof invitationCreateSchema>;
export type InvitationAccept = z.infer<typeof invitationAcceptSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type SetUserRole = z.infer<typeof setUserRoleSchema>;
