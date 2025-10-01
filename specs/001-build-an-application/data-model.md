# Data Model: Dermatology Photo Organization System

## Entity Definitions

### Patient
**Purpose**: Represents an individual patient receiving dermatological care.

**Fields**:
- `id: string` - Unique patient identifier (UUID)
- `name: string` - Patient's full name (required)
- `dateOfBirth: Date` - Patient's date of birth (required)
- `assignedDoctor: string` - Name of assigned dermatologist (required)
- `isUrgent: boolean` - Priority flag for urgent cases (default: false)
- `followUpDate: Date | null` - Scheduled follow-up appointment date
- `createdAt: Date` - Record creation timestamp
- `updatedAt: Date` - Last modification timestamp
- `notes: string` - Additional patient notes (optional)

**Validation Rules**:
- Name must be 2-100 characters
- Date of birth cannot be in the future
- Assigned doctor must be non-empty string
- Follow-up date must be in the future if set

**Relationships**:
- One-to-many with BodyPartCategory
- One-to-many with Photo (through BodyPartCategory)

### BodyPartCategory
**Purpose**: Hierarchical classification of anatomical regions for photo organization.

**Fields**:
- `id: string` - Unique category identifier (UUID)
- `patientId: string` - Foreign key to Patient
- `name: string` - Body part name (e.g., "left arm", "torso", "face")
- `parentId: string | null` - Parent category for hierarchical structure
- `level: number` - Hierarchy level (0 = top level, 1 = sub-part, etc.)
- `displayOrder: number` - Sort order within same level
- `createdAt: Date` - Category creation timestamp
- `photoCount: number` - Cached count of photos in this category

**Validation Rules**:
- Name must be 1-50 characters
- Level must be 0-3 (maximum 4 levels of hierarchy)
- Parent ID must exist if not null
- Display order must be positive integer

**Relationships**:
- Many-to-one with Patient
- One-to-many with Photo
- Self-referencing (parent/child categories)

### Photo
**Purpose**: Individual medical photograph with metadata and body part association.

**Fields**:
- `id: string` - Unique photo identifier (UUID)
- `patientId: string` - Foreign key to Patient
- `bodyPartCategoryId: string` - Foreign key to BodyPartCategory
- `fileName: string` - Original file name
- `filePath: string` - Local file system path
- `captureDate: Date` - When photo was taken
- `fileSize: number` - File size in bytes
- `width: number` - Image width in pixels
- `height: number` - Image height in pixels
- `mimeType: string` - Image MIME type (e.g., "image/jpeg")
- `thumbnailPath: string | null` - Path to thumbnail file
- `description: string` - Medical description or notes
- `isUrgent: boolean` - Urgent attention flag
- `metadata: PhotoMetadata` - Additional EXIF and medical metadata
- `createdAt: Date` - Record creation timestamp

**PhotoMetadata Interface**:
```typescript
interface PhotoMetadata {
  cameraInfo?: {
    make: string;
    model: string;
    settings: string;
  };
  medicalInfo?: {
    lesionType: string;
    size: string;
    color: string;
    symptoms: string[];
  };
  location?: {
    anatomicalRegion: string;
    laterality: 'left' | 'right' | 'bilateral' | 'midline';
    proximity: string;
  };
}
```

**Validation Rules**:
- File name must be valid filename (no special characters)
- File path must be accessible
- Capture date cannot be in the future
- File size must be positive
- Width and height must be positive integers
- MIME type must be image/* format

**Relationships**:
- Many-to-one with Patient
- Many-to-one with BodyPartCategory

### ProgressSession
**Purpose**: Groups photos taken during the same examination session for progress tracking.

**Fields**:
- `id: string` - Unique session identifier (UUID)
- `patientId: string` - Foreign key to Patient
- `sessionDate: Date` - Date of examination session
- `sessionType: string` - Type of session (initial, follow-up, urgent)
- `description: string` - Session notes
- `doctorName: string` - Examining physician
- `photoIds: string[]` - Array of photo IDs from this session
- `findings: string` - Medical findings and observations
- `recommendations: string` - Treatment recommendations
- `nextFollowUp: Date | null` - Recommended next appointment

**Validation Rules**:
- Session date cannot be in the future
- Session type must be from predefined list
- Doctor name must be non-empty
- Photo IDs must reference existing photos

**Relationships**:
- Many-to-one with Patient
- Many-to-many with Photo (through photoIds array)

### ExportReport
**Purpose**: PDF export configuration and history.

**Fields**:
- `id: string` - Unique report identifier (UUID)
- `patientId: string` - Foreign key to Patient
- `reportType: string` - Type of report (progress, summary, specific-session)
- `generatedAt: Date` - Report generation timestamp
- `parameters: ReportParameters` - Export configuration
- `filePath: string` - Path to generated PDF file
- `pageCount: number` - Number of pages in report
- `includedPhotoIds: string[]` - Photos included in report

**ReportParameters Interface**:
```typescript
interface ReportParameters {
  dateRange?: {
    startDate: Date;
    endDate: Date;
  };
  bodyParts?: string[]; // Specific body part categories
  includeProgressComparison: boolean;
  includeMedicalNotes: boolean;
  photoLayout: 'grid' | 'timeline' | 'comparison';
  sortOrder: 'date' | 'bodyPart' | 'urgency';
}
```

**Validation Rules**:
- Report type must be from predefined list
- Generated date cannot be in the future
- File path must be valid
- Page count must be positive

**Relationships**:
- Many-to-one with Patient
- References multiple Photos (through includedPhotoIds)

## State Transitions

### Patient Lifecycle
```
Created → Active → [Urgent] → Follow-up → Archived
```

### Photo Workflow
```
Captured → Processed → Categorized → [Flagged as Urgent] → Archived
```

### Export Process
```
Requested → Parameters Set → Photos Selected → PDF Generated → Downloaded
```

## Data Storage Architecture

### IndexedDB Schema
```typescript
// Database: DermatologyApp v1.0
const dbSchema = {
  patients: {
    keyPath: 'id',
    indexes: ['name', 'dateOfBirth', 'assignedDoctor', 'isUrgent', 'followUpDate']
  },
  bodyPartCategories: {
    keyPath: 'id',
    indexes: ['patientId', 'name', 'parentId', 'level']
  },
  photos: {
    keyPath: 'id',
    indexes: ['patientId', 'bodyPartCategoryId', 'captureDate', 'isUrgent']
  },
  progressSessions: {
    keyPath: 'id',
    indexes: ['patientId', 'sessionDate', 'sessionType']
  },
  exportReports: {
    keyPath: 'id',
    indexes: ['patientId', 'generatedAt', 'reportType']
  }
};
```

### File System Organization
```
[User-Selected Directory]/
├── patients/
│   ├── [patient-id]/
│   │   ├── photos/
│   │   │   ├── [body-part]/
│   │   │   │   ├── original/
│   │   │   │   └── thumbnails/
│   │   └── reports/
│   └── [another-patient-id]/
├── backups/
└── exports/
```

## Performance Considerations

### Indexing Strategy
- Primary indexes on ID fields for direct lookup
- Composite indexes on common query patterns:
  - Patient + capture date for timeline views
  - Body part + capture date for progress tracking
  - Urgent flag + capture date for priority sorting

### Caching Strategy
- Photo metadata cached in IndexedDB
- Thumbnails generated on-demand and cached
- Body part hierarchy cached for navigation
- Search results cached for repeated queries

### Data Validation
- All model operations use TypeScript interfaces
- Runtime validation using Zod schemas
- Database constraints enforced at service layer
- File system validation before operations