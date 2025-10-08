# Data Model: Clinical Photo Documentation System

**Feature**: Clinical Photo Documentation System
**Branch**: `001-role-you-are`
**Date**: 2025-10-08

## Overview

This document defines the complete data model for the clinical photo documentation system, including entity schemas, relationships, validation rules, and state transitions. The model is designed for IndexedDB storage with TypeScript type safety.

---

## Entity Definitions

### 1. PhotoRecord

**Purpose**: Represents a single clinical photograph with associated metadata.

**Schema**:
```typescript
interface PhotoRecord {
  // Identity
  id: string;                    // UUID v4, primary key

  // Relationships
  patientId: string;             // Foreign key to Patient.id

  // Photo Data
  imageBlob: Blob;               // Binary photo data (JPEG, compressed)
  imageThumbnail: Blob;          // Thumbnail 200x200px for timeline performance
  originalFileName: string;      // Original file name if uploaded
  mimeType: string;              // e.g., "image/jpeg", "image/png"
  fileSizeBytes: number;         // Compressed file size

  // Clinical Metadata
  bodyPart: BodyPart;            // Enumerated anatomical region
  subpart: string | null;        // Custom anatomical detail (optional)
  clinicalNotes: string | null;  // Free-text clinical observations (optional)

  // Timestamps
  capturedAt: Date;              // When photo was taken (camera timestamp)
  createdAt: Date;               // When record was created in system
  updatedAt: Date;               // Last metadata modification timestamp

  // Audit Fields
  clinicianId: string;           // Who captured the photo
  isDeleted: boolean;            // Soft delete flag
  deletedAt: Date | null;        // When record was soft deleted
}
```

**Validation Rules**:
- `id`: Must be valid UUID v4
- `patientId`: Must reference existing Patient.id
- `imageBlob`: Must be non-empty Blob, max 20MB
- `imageThumbnail`: Must be non-empty Blob, max 100KB
- `mimeType`: Must be "image/jpeg", "image/png", "image/heic", or "image/webp"
- `fileSizeBytes`: Must be > 0 and ≤ 20,971,520 bytes (20MB)
- `bodyPart`: Must be valid BodyPart enum value
- `subpart`: Max 100 characters if provided
- `clinicalNotes`: Max 2000 characters if provided
- `capturedAt`: Cannot be in the future
- `createdAt`, `updatedAt`: Managed by system, cannot be user-modified
- `clinicianId`: Must reference authenticated clinician
- `isDeleted`: Defaults to false

**Indexes** (IndexedDB):
- Primary: `id`
- Foreign key: `patientId` (for timeline queries)
- Composite: `[patientId, capturedAt]` (for chronological timeline)
- Filter: `[patientId, bodyPart]` (for filtered timeline)
- Search: `clinicalNotes` (full-text search, implemented via array filtering)

**State Transitions**:
```
[New] → (capture photo) → [Draft]
[Draft] → (save metadata) → [Saved]
[Saved] → (edit metadata) → [Saved] (updatedAt changes)
[Saved] → (soft delete) → [Deleted] (isDeleted = true, deletedAt set)
[Deleted] → (restore) → [Saved] (isDeleted = false, deletedAt = null)
```

**Business Rules**:
- Original photo and capturedAt are immutable after creation
- Only clinicalNotes and subpart can be edited after save
- Deleting a photo does not affect other photos (referential integrity)
- Photos with isDeleted=true are excluded from timeline queries by default

---

### 2. Patient

**Purpose**: Represents an individual patient as an organizational container for photos.

**Schema**:
```typescript
interface Patient {
  // Identity
  id: string;                    // UUID v4, primary key
  name: string;                  // Display name (as entered)
  normalizedName: string;        // Lowercase, trimmed for case-insensitive search

  // Metadata
  photoCount: number;            // Denormalized count of active photos
  deletedPhotoCount: number;     // Count of soft-deleted photos

  // Timestamps
  createdAt: Date;               // When patient record was created
  updatedAt: Date;               // Last modification timestamp
  lastPhotoAt: Date | null;      // Timestamp of most recent photo

  // Audit
  clinicianId: string;           // Who created the patient record
  isArchived: boolean;           // Soft archive flag
  archivedAt: Date | null;
}
```

**Validation Rules**:
- `id`: Must be valid UUID v4
- `name`: Required, min 1 character, max 100 characters
- `normalizedName`: Auto-generated from name (name.trim().toLowerCase())
- `photoCount`: Must be ≥ 0, auto-calculated
- `deletedPhotoCount`: Must be ≥ 0, auto-calculated
- `createdAt`, `updatedAt`: Managed by system
- `lastPhotoAt`: Auto-updated when photos added
- `clinicianId`: Must reference authenticated clinician
- `isArchived`: Defaults to false

**Indexes** (IndexedDB):
- Primary: `id`
- Unique: `normalizedName` (prevent exact duplicates, warn user)
- Search: `normalizedName` (for patient search/autocomplete)

**State Transitions**:
```
[New] → (create first photo) → [Active]
[Active] → (delete all photos) → [Empty] (photoCount = 0)
[Active/Empty] → (archive) → [Archived] (isArchived = true)
[Archived] → (unarchive) → [Active/Empty]
```

**Business Rules**:
- Patient name is case-sensitive for display, case-insensitive for search
- Duplicate patient names allowed (e.g., "John Smith" vs "john smith") but system warns user
- `photoCount` and `lastPhotoAt` are denormalized for performance (updated via transaction)
- Archived patients are hidden from default patient list but can be restored
- Deleting all photos for a patient does not delete the patient record

---

### 3. BodyPart (Enum)

**Purpose**: Standardized anatomical regions for categorizing photos.

**Schema**:
```typescript
enum BodyPart {
  HEAD = 'head',
  FACE = 'face',
  SCALP = 'scalp',
  NECK = 'neck',
  CHEST = 'chest',
  ABDOMEN = 'abdomen',
  BACK = 'back',
  UPPER_ARM = 'upper_arm',
  FOREARM = 'forearm',
  HAND = 'hand',
  THIGH = 'thigh',
  LEG = 'leg',
  FOOT = 'foot',
  TORSO = 'torso',
}

// Display labels for UI
const BodyPartLabels: Record<BodyPart, string> = {
  [BodyPart.HEAD]: 'Head',
  [BodyPart.FACE]: 'Face',
  [BodyPart.SCALP]: 'Scalp',
  [BodyPart.NECK]: 'Neck',
  [BodyPart.CHEST]: 'Chest',
  [BodyPart.ABDOMEN]: 'Abdomen',
  [BodyPart.BACK]: 'Back',
  [BodyPart.UPPER_ARM]: 'Upper Arm',
  [BodyPart.FOREARM]: 'Forearm',
  [BodyPart.HAND]: 'Hand',
  [BodyPart.THIGH]: 'Thigh',
  [BodyPart.LEG]: 'Leg',
  [BodyPart.FOOT]: 'Foot',
  [BodyPart.TORSO]: 'Torso',
};
```

**Validation Rules**:
- Must be one of the defined enum values
- Cannot be null or empty for PhotoRecord

**Business Rules**:
- Enum is extensible (can add new body parts without breaking existing data)
- Display labels are for UI only (store enum value in database)

---

### 4. SubpartSuggestion

**Purpose**: Autocomplete cache for previously used subpart values per body part.

**Schema**:
```typescript
interface SubpartSuggestion {
  id: string;                    // UUID v4, primary key
  bodyPart: BodyPart;            // Which body part this subpart applies to
  subpart: string;               // The subpart text (normalized: trimmed, lowercase)
  displayText: string;           // Original case for display
  usageCount: number;            // How many times this subpart has been used
  lastUsedAt: Date;              // Most recent usage timestamp
  clinicianId: string;           // Who first created this subpart
}
```

**Validation Rules**:
- `id`: Must be valid UUID v4
- `bodyPart`: Must be valid BodyPart enum
- `subpart`: Required, max 100 characters, normalized
- `displayText`: Original case version of subpart
- `usageCount`: Must be ≥ 1
- `lastUsedAt`: Auto-updated on each use
- `clinicianId`: Must reference authenticated clinician

**Indexes** (IndexedDB):
- Primary: `id`
- Composite: `[bodyPart, subpart]` (unique constraint - prevent duplicates)
- Query: `bodyPart` (for autocomplete lookup)

**Business Rules**:
- New subparts auto-created when user enters novel text
- Suggestions sorted by usageCount DESC, then lastUsedAt DESC
- Suggestions shown only for matching bodyPart
- Editing a photo's subpart updates usageCount and lastUsedAt

---

### 5. Clinician

**Purpose**: Represents authenticated user who captures and manages photos.

**Schema**:
```typescript
interface Clinician {
  id: string;                    // UUID v4, primary key
  username: string;              // Unique username or email
  passcodeHash: string;          // SHA-256 hash of passcode (v1 simple auth)
  displayName: string;           // Full name for display

  // Preferences
  preferences: {
    theme: 'light' | 'dark' | 'system';
    defaultBodyPart: BodyPart | null;
    autoCompressPhotos: boolean;
    showDeletedPhotos: boolean;
  };

  // Timestamps
  createdAt: Date;
  lastLoginAt: Date | null;

  // Session
  sessionExpiresAt: Date | null; // Auto-logout timestamp
}
```

**Validation Rules**:
- `id`: Must be valid UUID v4
- `username`: Required, min 3 characters, max 50 characters, unique
- `passcodeHash`: Required, must be valid SHA-256 hex string
- `displayName`: Required, max 100 characters
- `preferences.theme`: Must be 'light', 'dark', or 'system'
- `preferences.defaultBodyPart`: Must be valid BodyPart or null
- `sessionExpiresAt`: Auto-set to 30 minutes from lastLoginAt

**Indexes** (IndexedDB):
- Primary: `id`
- Unique: `username`

**State Transitions**:
```
[New] → (register) → [Registered]
[Registered] → (login) → [Active Session] (sessionExpiresAt set)
[Active Session] → (30 min timeout OR logout) → [Logged Out]
[Logged Out] → (login) → [Active Session]
```

**Business Rules**:
- v1 supports single clinician only (multi-user in v2)
- Passcode must be 6+ characters, mix of letters and numbers
- Session expires after 30 minutes of inactivity
- Forgotten passcode = delete all data (no recovery mechanism in v1)

---

## Relationships

### ER Diagram

```
┌─────────────┐         1:N         ┌──────────────┐
│  Clinician  │──────────────────────│   Patient    │
└─────────────┘                      └──────────────┘
       │                                     │
       │ 1:N                                 │ 1:N
       │                                     │
       ▼                                     ▼
┌─────────────┐                      ┌──────────────┐
│ PhotoRecord │──────────────────────│ PhotoRecord  │
└─────────────┘       N:1            └──────────────┘

┌─────────────┐         1:N         ┌──────────────────────┐
│  BodyPart   │──────────────────────│ SubpartSuggestion    │
│   (enum)    │                      └──────────────────────┘
└─────────────┘
```

**Relationship Descriptions**:

1. **Clinician → Patient** (1:N)
   - One clinician creates many patients
   - Cascade: N/A (clinician cannot be deleted in v1)

2. **Clinician → PhotoRecord** (1:N)
   - One clinician captures many photos
   - Cascade: N/A (clinician cannot be deleted in v1)

3. **Patient → PhotoRecord** (1:N)
   - One patient has many photos
   - Cascade: Soft delete patient → hide photos (isDeleted flag)
   - Referential integrity: patientId must exist

4. **BodyPart → SubpartSuggestion** (1:N)
   - One body part has many subpart suggestions
   - Cascade: None (enum cannot be deleted)

---

## Validation Schemas (Zod)

### PhotoRecord Validation

```typescript
import { z } from 'zod';

export const photoRecordCreateSchema = z.object({
  patientId: z.string().uuid(),
  imageBlob: z.instanceof(Blob).refine(
    (blob) => blob.size > 0 && blob.size <= 20 * 1024 * 1024,
    { message: "Photo must be between 0 and 20MB" }
  ),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  bodyPart: z.nativeEnum(BodyPart),
  subpart: z.string().max(100).optional().nullable(),
  clinicalNotes: z.string().max(2000).optional().nullable(),
  capturedAt: z.date().max(new Date(), "Capture date cannot be in future"),
});

export const photoRecordUpdateSchema = z.object({
  subpart: z.string().max(100).optional().nullable(),
  clinicalNotes: z.string().max(2000).optional().nullable(),
});

export type PhotoRecordCreate = z.infer<typeof photoRecordCreateSchema>;
export type PhotoRecordUpdate = z.infer<typeof photoRecordUpdateSchema>;
```

### Patient Validation

```typescript
export const patientCreateSchema = z.object({
  name: z.string().min(1, "Patient name required").max(100).trim(),
});

export const patientUpdateSchema = z.object({
  name: z.string().min(1, "Patient name required").max(100).trim(),
});

export type PatientCreate = z.infer<typeof patientCreateSchema>;
export type PatientUpdate = z.infer<typeof patientUpdateSchema>;
```

### Clinician Validation

```typescript
export const clinicianRegisterSchema = z.object({
  username: z.string().min(3).max(50).trim().toLowerCase(),
  passcode: z.string().min(6, "Passcode must be at least 6 characters")
    .regex(/[a-zA-Z]/, "Passcode must contain letters")
    .regex(/[0-9]/, "Passcode must contain numbers"),
  displayName: z.string().min(1).max(100).trim(),
});

export const clinicianLoginSchema = z.object({
  username: z.string().min(3).max(50).trim().toLowerCase(),
  passcode: z.string().min(6),
});

export type ClinicianRegister = z.infer<typeof clinicianRegisterSchema>;
export type ClinicianLogin = z.infer<typeof clinicianLoginSchema>;
```

---

## IndexedDB Schema

### Database Configuration

```typescript
const DB_NAME = 'CamogDB';
const DB_VERSION = 1;

const STORES = {
  PHOTOS: 'photos',
  PATIENTS: 'patients',
  SUBPARTS: 'subparts',
  CLINICIANS: 'clinicians',
} as const;
```

### Store Definitions

```typescript
// Store: photos
{
  keyPath: 'id',
  autoIncrement: false,
  indexes: [
    { name: 'patientId', keyPath: 'patientId', unique: false },
    { name: 'patientId_capturedAt', keyPath: ['patientId', 'capturedAt'], unique: false },
    { name: 'patientId_bodyPart', keyPath: ['patientId', 'bodyPart'], unique: false },
    { name: 'clinicianId', keyPath: 'clinicianId', unique: false },
    { name: 'isDeleted', keyPath: 'isDeleted', unique: false },
  ]
}

// Store: patients
{
  keyPath: 'id',
  autoIncrement: false,
  indexes: [
    { name: 'normalizedName', keyPath: 'normalizedName', unique: false }, // Allow duplicates
    { name: 'clinicianId', keyPath: 'clinicianId', unique: false },
    { name: 'isArchived', keyPath: 'isArchived', unique: false },
  ]
}

// Store: subparts
{
  keyPath: 'id',
  autoIncrement: false,
  indexes: [
    { name: 'bodyPart', keyPath: 'bodyPart', unique: false },
    { name: 'bodyPart_subpart', keyPath: ['bodyPart', 'subpart'], unique: true },
    { name: 'clinicianId', keyPath: 'clinicianId', unique: false },
  ]
}

// Store: clinicians
{
  keyPath: 'id',
  autoIncrement: false,
  indexes: [
    { name: 'username', keyPath: 'username', unique: true },
  ]
}
```

---

## Data Access Patterns

### Common Queries

1. **Get patient timeline (all photos for patient)**
   ```typescript
   const photos = await db.getAllFromIndex(
     'photos',
     'patientId',
     patientId
   ).then(photos => photos.filter(p => !p.isDeleted)
     .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
   );
   ```

2. **Get filtered timeline (by body part)**
   ```typescript
   const photos = await db.getAllFromIndex(
     'photos',
     'patientId_bodyPart',
     [patientId, bodyPart]
   ).then(photos => photos.filter(p => !p.isDeleted));
   ```

3. **Search patients by name**
   ```typescript
   const patients = await db.getAllFromIndex(
     'patients',
     'normalizedName'
   ).then(patients => patients.filter(p =>
     p.normalizedName.includes(searchTerm.toLowerCase()) && !p.isArchived
   ));
   ```

4. **Get subpart autocomplete suggestions**
   ```typescript
   const suggestions = await db.getAllFromIndex(
     'subparts',
     'bodyPart',
     bodyPart
   ).then(subs => subs.sort((a, b) =>
     b.usageCount - a.usageCount || b.lastUsedAt.getTime() - a.lastUsedAt.getTime()
   ));
   ```

5. **Search photos by clinical notes keyword**
   ```typescript
   const photos = await db.getAll('photos').then(photos =>
     photos.filter(p =>
       !p.isDeleted &&
       p.clinicalNotes?.toLowerCase().includes(keyword.toLowerCase())
     )
   );
   ```

---

## Migration Strategy

### Version 1 → Version 2 (Future)

When schema changes are needed:

```typescript
db.addEventListener('versionchange', (event) => {
  const db = event.target.result;
  const oldVersion = event.oldVersion;
  const newVersion = event.newVersion;

  if (oldVersion < 2) {
    // Example: Add new field to PhotoRecord
    const store = transaction.objectStore('photos');
    // Migration logic here
  }
});
```

**Best Practices**:
- Never remove fields (add nullable fields instead)
- Add indexes incrementally
- Test migrations with production-like data volumes
- Provide rollback mechanism (export/import JSON backup)

---

## Performance Considerations

### Denormalization Decisions

**Denormalized Fields**:
- `Patient.photoCount`: Avoid COUNT(*) query every time patient list is displayed
- `Patient.lastPhotoAt`: Show "last activity" without querying photos table
- `Patient.deletedPhotoCount`: Track deleted photos without complex queries

**Trade-offs**:
- Write amplification: Must update Patient when PhotoRecord changes
- Eventual consistency risk: Use IndexedDB transactions to ensure atomicity
- Benefit: 10x faster patient list rendering (measured by success criteria SC-002)

### Thumbnail Generation

- Generate 200x200px thumbnail on photo capture
- Store separately from full-resolution image
- Timeline loads only thumbnails (reduces memory usage by ~90%)
- Full-resolution loaded on-demand when viewing/comparing

### Virtual Scrolling Integration

- Timeline component requests photos in batches of 50
- IndexedDB cursor API for pagination (don't load all 1000+ photos at once)
- Intersection Observer triggers next batch load
- Meets success criteria SC-002 (<2s for 50+ photos)

---

## Security & Privacy

### Data Isolation

- v1: Single clinician, all data in local IndexedDB (no multi-user access)
- v2: Multi-clinician would require encrypted storage or backend database

### HIPAA Compliance Notes

**Current v1 Status**: NOT HIPAA-compliant
- No encryption at rest (IndexedDB is unencrypted)
- No audit logging for data access
- No backup/disaster recovery
- Passcode authentication is weak

**v2 Requirements for HIPAA**:
- Encrypt IndexedDB data (Web Crypto API + user passphrase)
- Implement comprehensive audit logs
- Add automatic session timeout and re-authentication
- Backup/export mechanism with encryption
- Access controls and role-based permissions

---

## Summary

### Entity Count
- **4 core entities**: PhotoRecord, Patient, Clinician, SubpartSuggestion
- **1 enum**: BodyPart (14 values)
- **4 IndexedDB stores**: photos, patients, clinicians, subparts

### Key Design Decisions
✅ Soft deletes (isDeleted flag) preserve data integrity
✅ Denormalized counts improve query performance
✅ Thumbnail generation reduces memory footprint
✅ Composite indexes support complex filtering
✅ Zod validation ensures type safety at runtime
✅ Normalized patient names enable case-insensitive search

### Validation Coverage
✅ All user inputs validated with Zod schemas
✅ File size constraints enforced (20MB max photo, 100KB max thumbnail)
✅ String length limits prevent database bloat
✅ UUID validation prevents malformed IDs
✅ Date constraints prevent invalid timestamps

### Performance Optimizations
✅ Indexed queries for fast lookups (O(log n) vs O(n))
✅ Denormalized fields avoid expensive JOIN-equivalent operations
✅ Thumbnail caching reduces full-image loading
✅ Virtual scrolling handles 1000+ photos without UI lag

All requirements from spec.md are fully represented in this data model. Ready for contract generation (Phase 1 continuation).
