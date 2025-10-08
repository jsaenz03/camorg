# Service Contracts

This directory contains TypeScript interface definitions for all services in the clinical photo documentation system.

## Purpose

Service contracts define:
- **Method signatures**: Parameters, return types, error types
- **Business rules**: Side effects, validation constraints, state transitions
- **Documentation**: Usage examples, performance notes, security considerations

These contracts serve as the "API specification" for the application, even though all services are client-side (no HTTP API in v1).

## Services

### Core Data Services

1. **[photo-service.ts](./photo-service.ts)** - `IPhotoService`
   - Photo CRUD operations (create, read, update, delete/restore)
   - Search photos by clinical notes
   - Export photos for sharing
   - Get photos for comparison view

2. **[patient-service.ts](./patient-service.ts)** - `IPatientService`
   - Patient CRUD operations
   - Search patients by name
   - Archive/unarchive patients
   - Manage denormalized photo counts

3. **[subpart-service.ts](./subpart-service.ts)** - `ISubpartService`
   - Autocomplete suggestions for subparts
   - Record usage (create/update suggestions)
   - Merge duplicate suggestions
   - Clear suggestions per body part

### Platform Services

4. **[camera-service.ts](./camera-service.ts)** - `ICameraService`
   - Camera access via MediaDevices API
   - Capture photos from video stream
   - Switch cameras (front/rear)
   - Compress and generate thumbnails
   - Zoom control

5. **[auth-service.ts](./auth-service.ts)** - `IAuthService`
   - Registration and login (passcode-based)
   - Session management (30-minute timeout)
   - Change passcode
   - Reset app (factory reset for forgot passcode)
   - Preferences management

## Implementation Guidelines

### Error Handling

All services define custom error types:
- **ValidationError**: Data fails Zod schema validation
- **NotFoundError**: Entity does not exist
- **PermissionDeniedError**: User denied browser permission (camera, etc.)
- **StorageQuotaError**: IndexedDB quota exceeded

Implementations MUST throw these specific error types (not generic `Error`) for proper UI error handling.

### Transactions

Operations that modify multiple entities (e.g., creating photo + updating patient count) MUST use IndexedDB transactions to ensure atomicity.

Example:
```typescript
async createPhoto(data: PhotoRecordCreate): Promise<PhotoRecord> {
  const tx = db.transaction(['photos', 'patients'], 'readwrite');
  try {
    // 1. Create photo record
    const photo = await tx.objectStore('photos').add(...);

    // 2. Update patient photo count
    await patientService.updatePhotoCount(data.patientId, +1, false);

    await tx.complete;
    return photo;
  } catch (error) {
    // Transaction auto-rolls back on error
    throw error;
  }
}
```

### Performance Contracts

Methods include performance notes where applicable:
- **O(n) operations**: Full table scans (e.g., search by clinical notes)
- **Indexed queries**: O(log n) lookups (e.g., get photos by patientId)
- **Virtual scrolling**: Methods designed for paginated access (e.g., timeline)

### Type Safety

All methods use TypeScript types from `@/types/*`:
- Input validation via Zod schemas (runtime type checking)
- Return types match entity interfaces
- No `any` types allowed (constitution requirement)

## Testing Strategy

While tests are optional per constitution, contracts define testable behaviors:

### Unit Tests (Service Layer)
- Test each method in isolation with mocked IndexedDB
- Verify error handling (invalid inputs, missing entities)
- Validate business rules (e.g., denormalized count updates)

### Integration Tests
- Test multi-service workflows (e.g., create photo → update patient)
- Verify transaction rollback on failures
- Test IndexedDB schema migrations

### Component Tests
- Mock service interfaces to test UI components in isolation
- Verify error states are displayed correctly

Example test structure:
```typescript
describe('PhotoService', () => {
  describe('createPhoto', () => {
    it('should create photo and update patient count in transaction', async () => {
      // Arrange
      const mockData: PhotoRecordCreate = { ... };

      // Act
      const photo = await photoService.createPhoto(mockData);

      // Assert
      expect(photo.id).toBeUUID();
      expect(photo.patientId).toBe(mockData.patientId);

      const patient = await patientService.getPatientById(mockData.patientId);
      expect(patient.photoCount).toBe(1);
    });

    it('should throw ValidationError for invalid data', async () => {
      const invalidData = { patientId: 'not-a-uuid' };
      await expect(photoService.createPhoto(invalidData)).rejects.toThrow(ValidationError);
    });

    it('should throw StorageQuotaError when IndexedDB quota exceeded', async () => {
      // Mock quota exceeded scenario
      await expect(photoService.createPhoto(validData)).rejects.toThrow(StorageQuotaError);
    });
  });
});
```

## Usage in Components

Components should depend on interfaces, not implementations (dependency injection pattern):

```typescript
// components/camera/camera-capture.tsx
interface CameraCaptureProps {
  cameraService: ICameraService;  // Inject interface
  photoService: IPhotoService;
  onPhotoSaved: (photo: PhotoRecord) => void;
}

export function CameraCapture({ cameraService, photoService, onPhotoSaved }: CameraCaptureProps) {
  const handleCapture = async () => {
    try {
      const captured = await cameraService.capturePhoto(videoRef.current);
      const photo = await photoService.createPhoto({
        ...metadata,
        imageBlob: captured.blob,
      });
      onPhotoSaved(photo);
    } catch (error) {
      if (error instanceof ValidationError) {
        // Show inline validation errors
      } else if (error instanceof StorageQuotaError) {
        // Show storage warning dialog
      }
    }
  };
}
```

This pattern:
- Makes components testable (inject mock services)
- Enforces contract compliance
- Enables future refactoring (swap implementations)

## Contract Versioning

When contracts change:
1. **Breaking changes**: Increment contract version in comments, update all implementations
2. **Additions**: Add new methods with default implementations or feature flags
3. **Deprecations**: Mark with `@deprecated` JSDoc tag, remove after migration period

## Related Documents

- **[../data-model.md](../data-model.md)**: Entity schemas and validation rules
- **[../research.md](../research.md)**: Technology decisions and implementation patterns
- **[../quickstart.md](../quickstart.md)**: Step-by-step implementation guide
