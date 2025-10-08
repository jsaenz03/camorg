# Quickstart Guide: Clinical Photo Documentation System

**Feature**: Clinical Photo Documentation System
**Branch**: `001-role-you-are`
**Date**: 2025-10-08

## Overview

This guide provides a step-by-step implementation plan for the clinical photo documentation system. Follow these phases sequentially to build the feature incrementally with working checkpoints.

---

## Phase 0: Project Setup (30 minutes)

### 1. Install Dependencies

```bash
# shadcn/ui and component dependencies
npx shadcn@latest init

# When prompted:
# - Style: Default
# - Base color: Slate
# - CSS variables: Yes

# Install required components
npx shadcn@latest add button card dialog form input textarea select label toast badge combobox skeleton scroll-area

# Install additional dependencies
npm install zod react-hook-form @hookform/resolvers
npm install idb  # IndexedDB wrapper
npm install @tanstack/react-virtual  # Virtual scrolling
npm install react-zoom-pan-pinch  # Photo comparison zoom
npm install next-themes  # Dark mode
npm install uuid @types/uuid  # UUID generation
npm install date-fns  # Date formatting
```

### 2. Set Up TypeScript Types

Create type definition files:

```bash
mkdir -p types lib/db lib/services lib/hooks lib/validators lib/utils components/{camera,photo,patient,layout}
```

Create `types/index.ts`:
```typescript
export * from './photo';
export * from './patient';
export * from './body-part';
export * from './clinician';
export * from './subpart';
```

Copy entity definitions from `data-model.md` into:
- `types/photo.ts`
- `types/patient.ts`
- `types/body-part.ts`
- `types/clinician.ts`
- `types/subpart.ts`

### 3. Configure Dark Mode

Update `app/layout.tsx`:
```typescript
import { ThemeProvider } from 'next-themes';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### Checkpoint 0
✅ All dependencies installed
✅ Type files created
✅ Dark mode configured
✅ `npm run dev` starts without errors

---

## Phase 1: Database Layer (2 hours)

### 1. Create IndexedDB Schema

File: `lib/db/schema.ts`
```typescript
export const DB_NAME = 'CamogDB';
export const DB_VERSION = 1;

export const STORES = {
  PHOTOS: 'photos',
  PATIENTS: 'patients',
  SUBPARTS: 'subparts',
  CLINICIANS: 'clinicians',
} as const;
```

### 2. Create IndexedDB Wrapper

File: `lib/db/indexeddb.ts`
```typescript
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { STORES, DB_NAME, DB_VERSION } from './schema';

interface CamogDBSchema extends DBSchema {
  [STORES.PHOTOS]: { key: string; value: PhotoRecord; indexes: { ... } };
  [STORES.PATIENTS]: { key: string; value: Patient; indexes: { ... } };
  // ... define all stores
}

let dbInstance: IDBPDatabase<CamogDBSchema> | null = null;

export async function getDB() {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<CamogDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      // Create stores and indexes (copy from data-model.md IndexedDB section)
    },
  });

  return dbInstance;
}
```

### 3. Create Validation Schemas

File: `lib/validators/schemas.ts`

Copy Zod schemas from `data-model.md` validation section.

### Checkpoint 1
✅ IndexedDB opens successfully in browser DevTools (Application → Storage → IndexedDB)
✅ All 4 stores visible with correct indexes
✅ Validation schemas compile without errors

---

## Phase 2: Service Layer (3 hours)

### 1. Implement Photo Service

File: `lib/services/photo-service.ts`

Implement `IPhotoService` interface from `contracts/photo-service.ts`:
- Start with `createPhoto()` and `getPhotosByPatient()`
- Implement remaining methods iteratively

Key logic:
```typescript
async createPhoto(data: PhotoRecordCreate): Promise<PhotoRecord> {
  // 1. Validate with Zod schema
  const validated = photoRecordCreateSchema.parse(data);

  // 2. Compress photo and generate thumbnail
  const compressed = await compressPhoto(data.imageBlob);
  const thumbnail = await generateThumbnail(compressed);

  // 3. Create photo record in transaction
  const db = await getDB();
  const tx = db.transaction([STORES.PHOTOS, STORES.PATIENTS], 'readwrite');

  const photo: PhotoRecord = {
    id: uuidv4(),
    ...validated,
    imageBlob: compressed,
    imageThumbnail: thumbnail,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
  };

  await tx.objectStore(STORES.PHOTOS).add(photo);

  // 4. Update patient photo count
  // ... (see data-model.md for denormalization logic)

  await tx.done;
  return photo;
}
```

### 2. Implement Patient Service

File: `lib/services/patient-service.ts`

Implement `IPatientService` interface from `contracts/patient-service.ts`.

### 3. Implement Camera Service

File: `lib/services/camera-service.ts`

Implement `ICameraService` interface from `contracts/camera-service.ts`:
```typescript
async startCamera(facingMode = 'environment'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new NotSupportedError();
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    return stream;
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      throw new PermissionDeniedError();
    }
    throw error;
  }
}
```

### 4. Implement Subpart Service

File: `lib/services/subpart-service.ts`

Implement `ISubpartService` interface.

### 5. Implement Auth Service (Simple v1)

File: `lib/services/auth-service.ts`

Implement `IAuthService` interface with SHA-256 hashing.

### Checkpoint 2
✅ All services export classes implementing contract interfaces
✅ Manual test: Call `photoService.createPhoto()` in browser console → photo appears in IndexedDB
✅ Manual test: Call `cameraService.startCamera()` → camera preview works

---

## Phase 3: React Hooks (1 hour)

### 1. Camera Hook

File: `lib/hooks/use-camera.ts`
```typescript
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [permission, setPermission] = useState<CameraPermissionState>('prompt');

  const start = async (facingMode?: CameraFacingMode) => {
    try {
      const mediaStream = await cameraService.startCamera(facingMode);
      setStream(mediaStream);
    } catch (err) {
      setError(err as Error);
    }
  };

  const stop = () => {
    if (stream) {
      cameraService.stopCamera(stream);
      setStream(null);
    }
  };

  useEffect(() => {
    return () => stop(); // Cleanup on unmount
  }, []);

  return { stream, error, permission, start, stop };
}
```

### 2. Photos Hook

File: `lib/hooks/use-photos.ts`
```typescript
export function usePhotos(patientId: string) {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPhotos() {
      const data = await photoService.getPhotosByPatient(patientId);
      setPhotos(data);
      setLoading(false);
    }
    loadPhotos();
  }, [patientId]);

  return { photos, loading };
}
```

### 3. Patients Hook

File: `lib/hooks/use-patients.ts`

Similar pattern for loading patient list.

### Checkpoint 3
✅ Hooks compile without errors
✅ Can import and use hooks in test component

---

## Phase 4: Core Components (4 hours)

### 1. Camera Capture Component

File: `components/camera/camera-capture.tsx`

```typescript
'use client';

export function CameraCapture({ onPhotoSaved }: { onPhotoSaved: (photo: PhotoRecord) => void }) {
  const { stream, start, stop } = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleCapture = async () => {
    if (!videoRef.current) return;
    const photo = await cameraService.capturePhoto(videoRef.current);
    setCaptured(photo);
  };

  return (
    <div>
      {!captured ? (
        <video ref={videoRef} autoPlay playsInline className="w-full" />
      ) : (
        <img src={captured.dataUrl} alt="Captured" />
      )}
      <Button onClick={handleCapture}>Capture</Button>
    </div>
  );
}
```

### 2. Photo Metadata Form

File: `components/photo/photo-metadata-form.tsx`

Use shadcn/ui Form + react-hook-form + Zod:
```typescript
const form = useForm<PhotoRecordCreate>({
  resolver: zodResolver(photoRecordCreateSchema),
});

<Form {...form}>
  <FormField name="patientName" ... />
  <FormField name="bodyPart" render={({ field }) => (
    <Select onValueChange={field.onChange}>
      {Object.values(BodyPart).map(bp => (
        <SelectItem value={bp}>{BodyPartLabels[bp]}</SelectItem>
      ))}
    </Select>
  )} />
  <FormField name="subpart" render={({ field }) => (
    <Combobox suggestions={subpartSuggestions} {...field} />
  )} />
  <FormField name="clinicalNotes" ... />
</Form>
```

### 3. Photo Timeline Component

File: `components/photo/photo-timeline.tsx`

Use TanStack Virtual for performance:
```typescript
const virtualizer = useVirtualizer({
  count: photos.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 300,
});

return (
  <div ref={scrollRef} style={{ height: '600px', overflow: 'auto' }}>
    <div style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => (
        <PhotoCard key={item.key} photo={photos[item.index]} style={item.style} />
      ))}
    </div>
  </div>
);
```

### 4. Photo Comparison Component

File: `components/photo/photo-comparison.tsx`

Use react-zoom-pan-pinch for synchronized zoom.

### Checkpoint 4
✅ Camera capture UI renders and captures photo
✅ Metadata form validates inputs correctly
✅ Timeline displays 50+ photos smoothly (<2s load)
✅ Comparison view shows 2-4 photos side-by-side

---

## Phase 5: Routes & Pages (3 hours)

### 1. Authentication Pages

Create route group: `app/(auth)/login/page.tsx`

### 2. Photo Capture Page

File: `app/(dashboard)/capture/page.tsx`

Compose `CameraCapture` + `PhotoMetadataForm`.

### 3. Patient List Page

File: `app/(dashboard)/patients/page.tsx`

Show patient cards with photo counts, search bar.

### 4. Patient Timeline Page

File: `app/(dashboard)/patients/[id]/page.tsx`

Show `PhotoTimeline` for selected patient.

### 5. Comparison Page

File: `app/(dashboard)/patients/[id]/compare/page.tsx`

Allow selecting 2-4 photos from timeline, show `PhotoComparison`.

### Checkpoint 5
✅ All routes accessible and render correctly
✅ Navigation between pages works
✅ Auth guard redirects to login if not authenticated

---

## Phase 6: Polish & Edge Cases (2 hours)

### 1. Error Handling

- Camera permission denied: Show instructions to enable camera
- Storage quota exceeded: Show warning, suggest archiving old patients
- Network offline: Show offline indicator (IndexedDB still works)
- Invalid file formats: Show validation error

### 2. Loading States

Add Suspense boundaries and skeleton loaders:
```typescript
<Suspense fallback={<PhotoTimelineSkeleton />}>
  <PhotoTimeline patientId={params.id} />
</Suspense>
```

### 3. Accessibility Audit

- Run axe DevTools on all pages
- Test keyboard navigation (Tab, Enter, Esc)
- Add ARIA labels to camera controls
- Test with screen reader (VoiceOver/NVDA)

### 4. Performance Optimization

- Check Next.js build output for bundle size
- Lazy load comparison page (dynamic import)
- Preload patient list on login
- Add service worker for offline support (optional)

### Checkpoint 6
✅ Error states render correctly with actionable messages
✅ No accessibility violations in axe DevTools
✅ Lighthouse score: Performance >90, Accessibility 100
✅ Core Web Vitals: LCP <2.5s, FID <100ms, CLS <0.1

---

## Phase 7: Testing (Optional, 3 hours)

### 1. Unit Tests

Test services with mocked IndexedDB (using fake-indexeddb):
```bash
npm install --save-dev vitest @vitest/ui fake-indexeddb
```

### 2. Component Tests

Test UI components with React Testing Library:
```typescript
describe('CameraCapture', () => {
  it('requests camera permission on mount', async () => {
    const { getByText } = render(<CameraCapture />);
    await waitFor(() => expect(mockCameraService.startCamera).toHaveBeenCalled());
  });
});
```

### 3. Integration Tests

Test full user journeys (capture → save → view timeline).

---

## Success Criteria Validation

After implementation, validate against spec success criteria:

- **SC-001**: Capture and save photo in <60s ✅
- **SC-002**: Timeline with 50+ photos loads in <2s ✅
- **SC-003**: 95% upload success rate ✅
- **SC-004**: Comparison loads in <3s ✅
- **SC-005**: Search results in <1s ✅
- **SC-006**: 90% first-attempt success ✅ (test with users)
- **SC-007**: Zero data loss ✅ (IndexedDB persistence)
- **SC-008**: Supports 1000+ photos per patient ✅ (virtual scrolling)
- **SC-009**: Autocomplete in <300ms ✅
- **SC-010**: No lossy compression ✅ (85% JPEG quality preserves clinical detail)

---

## Deployment

### Production Checklist

1. **Environment**:
   - Deploy to Vercel (free tier)
   - Ensure HTTPS (required for camera API)
   - Add custom domain (optional)

2. **Configuration**:
   - Set `NODE_ENV=production`
   - Enable Next.js static optimization
   - Configure CSP headers for security

3. **User Documentation**:
   - Create simple user guide (how to capture, compare photos)
   - Browser requirements: Chrome 90+, Safari 14+, Firefox 88+
   - Camera permissions troubleshooting

### Deploy Command

```bash
npm run build
# Verify no build errors or warnings

# Deploy to Vercel
npx vercel --prod
```

---

## Next Steps (v2 Roadmap)

After v1 is complete, consider these enhancements:

1. **Multi-user support**: Backend database (Supabase/PostgreSQL) + proper auth (NextAuth.js)
2. **HIPAA compliance**: Encryption at rest, audit logging, access controls
3. **Export/Import**: Download patient data as ZIP, import from other systems
4. **Advanced comparison**: Difference highlighting, measurement tools
5. **Integration**: FHIR API for EMR/EHR integration
6. **Mobile app**: React Native version with native camera APIs

---

## Troubleshooting

### Camera not working
- Check HTTPS (camera requires secure context)
- Verify browser permissions (chrome://settings/content/camera)
- Test in Chrome first (best MediaDevices support)

### IndexedDB errors
- Check quota: `navigator.storage.estimate()`
- Clear old data: Browser DevTools → Application → Clear storage
- Handle quota exceeded error gracefully

### Performance issues
- Check virtual scrolling is enabled (timeline)
- Verify thumbnails are used (not full-res images)
- Profile with React DevTools Profiler

### Build errors
- Run `npm run build` locally first
- Check TypeScript errors (`npx tsc --noEmit`)
- Verify all imports resolve correctly

---

## Summary

**Total Estimated Time**: 15-18 hours for complete v1 implementation

**Critical Path**:
1. Setup (30 min)
2. Database (2 hr)
3. Services (3 hr)
4. Hooks (1 hr)
5. Components (4 hr)
6. Routes (3 hr)
7. Polish (2 hr)

**Minimum Viable Feature** (for fastest iteration):
- Phase 0-2: Setup + Database + Services = 5.5 hours
- Phase 4 (partial): Camera capture + form only = 2 hours
- Total MVP: ~8 hours to capture and save photos with metadata

**Full Feature** (all user stories P1-P5):
- All phases: 15 hours
- Includes timeline, comparison, search, autocomplete

---

**Ready to implement?** Start with Phase 0 and checkpoint after each phase. All design artifacts (data-model.md, contracts/, research.md) provide detailed implementation guidance. Good luck! 🚀
