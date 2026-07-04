import { z } from 'zod';
import { BodyPart } from '@/types/body-part';

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
export const patientCreateSchema = z.object({
  name: z.string().min(1, 'Patient name is required').max(100, 'Patient name must be 100 characters or less').trim(),
});

export const patientUpdateSchema = z.object({
  name: z.string().min(1, 'Patient name is required').max(100, 'Patient name must be 100 characters or less').trim(),
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
  passcode: z
    .string()
    .min(6, 'Passcode must be at least 6 characters')
    .regex(/[a-zA-Z]/, 'Passcode must contain at least one letter')
    .regex(/[0-9]/, 'Passcode must contain at least one number'),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less')
    .trim(),
});

export const clinicianLoginSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be 50 characters or less')
    .trim()
    .toLowerCase(),
  passcode: z.string().min(6, 'Passcode must be at least 6 characters'),
});

export type ClinicianRegister = z.infer<typeof clinicianRegisterSchema>;
export type ClinicianLogin = z.infer<typeof clinicianLoginSchema>;
