# Research: Clinical Photo Documentation System

**Feature**: Clinical Photo Documentation System
**Branch**: `001-role-you-are`
**Date**: 2025-10-08

## Overview

This document consolidates research findings for implementing a clinical photo documentation system. All technical decisions are documented with rationale and alternatives considered.

---

## 1. Camera Access in Web Browsers

### Decision: MediaDevices API (getUserMedia)

**Rationale**:
- Native browser API, no external dependencies required
- Supported in all modern browsers (Chrome 90+, Safari 14+, Firefox 88+, Edge 90+)
- Direct access to device cameras (front/rear on mobile, webcam on desktop)
- Provides video stream for live preview before capture
- Canvas API integration for capturing still frames
- Works with Next.js client components

**Implementation Approach**:
```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
});
```

**Alternatives Considered**:
- **HTML `<input type="file" capture="camera">`**: Simpler but no live preview, less control over resolution
- **Third-party libraries (react-webcam, react-camera)**: Additional dependencies, often just wrappers around getUserMedia
- **Progressive Web App (PWA) with native camera**: Over-engineering for v1, requires service worker complexity

**Constraints**:
- Requires HTTPS or localhost (security requirement)
- Users must grant camera permissions
- Different camera capabilities across devices (need fallback handling)

**Best Practices**:
- Request permissions only when needed (lazy permission request)
- Provide clear UI feedback for permission denied state
- Stop camera stream when not in use (battery/privacy)
- Handle device rotation and camera switch (front/back)
- Implement error boundaries for unsupported browsers

**References**:
- MDN: MediaDevices.getUserMedia() - https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Browser compatibility: Can I Use - https://caniuse.com/stream

---

## 2. Photo Storage Strategy

### Decision: IndexedDB for Photo Binaries + Metadata

**Rationale**:
- Browser-native NoSQL database designed for large binary data (Blobs)
- No size limit constraints like localStorage (5-10MB) - typically 50MB+ available
- Async API prevents UI blocking during large photo operations
- Supports indexes for fast queries (by patient ID, date, body part)
- Offline-first architecture - works without internet connection
- No server costs or backend infrastructure required for v1

**Schema Design**:
```typescript
// Store: 'photos'
interface PhotoRecord {
  id: string;              // UUID
  patientId: string;       // FK to patients
  imageBlob: Blob;         // Binary photo data
  bodyPart: string;
  subpart: string | null;
  clinicalNotes: string | null;
  capturedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Store: 'patients'
interface Patient {
  id: string;              // UUID
  name: string;
  normalizedName: string;  // Lowercase, trimmed for search
  photoCount: number;
  createdAt: Date;
}

// Store: 'subparts' (autocomplete cache)
interface SubpartSuggestion {
  id: string;
  bodyPart: string;
  subpart: string;
  usageCount: number;
}
```

**Alternatives Considered**:
- **localStorage**: 5-10MB limit insufficient for photos (2-5MB each)
- **Backend API + Cloud Storage (S3, Cloudinary)**: Adds complexity, cost, network dependency; not needed for v1 single-user model
- **File System Access API**: Limited browser support, requires user permission per file
- **Supabase/Firebase Storage**: Vendor lock-in, requires authentication setup, network dependency

**IndexedDB Library Choice: idb (Jake Archibald)**:
- Promise-based wrapper around IndexedDB
- Only 1.5KB gzipped
- TypeScript support
- Maintained by Google Chrome team member

**Best Practices**:
- Use transactions for atomic operations (photo + patient update)
- Create indexes on frequently queried fields (patientId, capturedAt, bodyPart)
- Implement database versioning for schema migrations
- Handle quota exceeded errors (show storage warning to user)
- Compress photos before storage (reduce to 1920px max dimension, 85% JPEG quality)

**Performance Considerations**:
- Virtual scrolling for timelines with 50+ photos (react-window or TanStack Virtual)
- Lazy load image Blobs (only fetch when visible in viewport)
- Use IndexedDB cursors for large result sets
- Cache recent queries in React state

**References**:
- IndexedDB API Guide: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- idb library: https://github.com/jakearchibald/idb
- Working with IndexedDB: https://web.dev/indexeddb/

---

## 3. Image Processing and Optimization

### Decision: Browser Canvas API for Compression

**Rationale**:
- Native browser API, no external dependencies
- Can resize and compress images client-side before storage
- Reduces storage footprint (2-5MB raw → ~500KB-1MB compressed)
- Faster timeline loading (smaller files to transfer from IndexedDB)
- Maintains sufficient quality for clinical review (85% JPEG quality)

**Implementation Strategy**:
```typescript
// Resize to max 1920px width/height, maintain aspect ratio
// Compress to 85% JPEG quality
// Convert to Blob for IndexedDB storage
```

**Alternatives Considered**:
- **Browser-image-compression library**: 15KB gzipped, provides more features but adds dependency
- **Sharp (server-side)**: Requires Node.js backend, not applicable for client-only app
- **Store original high-res**: Wastes storage, slows down timeline rendering; clinicians can request original if needed

**Best Practices**:
- Always preserve original aspect ratio
- Use canvas.toBlob() with quality parameter for compression
- Perform compression in Web Worker to avoid UI blocking (for large batches)
- Show progress indicator during compression
- Validate file size after compression (warn if >5MB compressed)

**Image Format Handling**:
- Accept: JPEG, PNG, HEIC (iOS), WebP
- Store as: JPEG (universal compatibility, good compression for photos)
- HEIC conversion: Use browser's native image decoding (via canvas drawImage)

**References**:
- Canvas API: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
- Image compression techniques: https://web.dev/compress-images/

---

## 4. React Photo Comparison UI Patterns

### Decision: CSS Grid for Side-by-Side, Canvas for Overlay

**Rationale**:
- CSS Grid: Simple, performant layout for 2-4 photo comparison
- Canvas overlay: Allows pixel-level transparency control and alignment
- Synchronized zoom: Shared state (React context) controls zoom level across all images
- Pinch-zoom support: react-zoom-pan-pinch library (11KB) handles touch gestures

**Side-by-Side Layout**:
```tsx
<div className="grid grid-cols-2 gap-4">
  {photos.map(photo => <PhotoViewer photo={photo} zoom={sharedZoom} />)}
</div>
```

**Overlay Mode**:
- Two canvas layers with CSS absolute positioning
- Top canvas has adjustable opacity (0-100% slider)
- Images scaled to same dimensions for alignment
- Optional: difference blend mode to highlight changes

**Alternatives Considered**:
- **react-compare-image**: Designed for 2-image slider, not 4-photo grid
- **Third-party medical imaging libraries (Cornerstone.js)**: Over-engineered for non-DICOM images, large bundle size (100KB+)
- **Native img elements only**: No overlay mode, harder to sync zoom

**Best Practices**:
- Debounce zoom/pan events to avoid performance issues
- Use CSS transforms (translate, scale) for smooth interactions
- Implement keyboard shortcuts (arrow keys for navigation, +/- for zoom)
- Show metadata overlay (capture date) on each photo
- Responsive: switch to vertical stack on mobile

**Accessibility Considerations**:
- ARIA labels describing each photo's capture date
- Keyboard navigation between photos
- Screen reader announces zoom level and current photo
- Focus visible indicators for keyboard users

**References**:
- react-zoom-pan-pinch: https://github.com/BetterTyped/react-zoom-pan-pinch
- CSS Grid layouts: https://css-tricks.com/snippets/css/complete-guide-grid/

---

## 5. shadcn/ui Component Selection

### Decision: Use shadcn/ui for Form Controls and Layouts

**Rationale**:
- Aligns with project constitution (Component-First Architecture)
- Unstyled primitives built on Radix UI (accessibility built-in)
- Copy-paste components (no npm package bloat)
- Full TypeScript support
- Tailwind CSS v4 integration (already in project)
- Dark mode support (constitution requirement)

**Components Needed**:
- **Form**: Patient name, body part, subpart, notes
- **Select**: Body part dropdown with search
- **Input**: Text inputs with validation
- **Textarea**: Clinical notes (multi-line)
- **Button**: Camera capture, save, cancel
- **Card**: Photo cards in timeline
- **Dialog**: Photo viewer modal, comparison view
- **Toast**: Success/error notifications
- **Badge**: Body part tags, photo counts
- **Combobox**: Autocomplete for subpart suggestions
- **Skeleton**: Loading states for photo timeline
- **ScrollArea**: Photo timeline scroll container

**Installation**:
```bash
npx shadcn@latest init
npx shadcn@latest add form select input textarea button card dialog toast badge combobox skeleton scroll-area
```

**Alternatives Considered**:
- **MUI (Material-UI)**: 300KB+ bundle size, opinionated design not matching medical UX
- **Chakra UI**: Good but larger bundle, less Tailwind-native
- **Build custom components**: Reinventing the wheel, accessibility harder to implement

**Best Practices**:
- Use Form component with react-hook-form + Zod validation
- Implement error states for all form fields
- Use Combobox for subpart autocomplete (keyboard navigable)
- Show loading skeletons during IndexedDB queries
- Toast notifications for success/error feedback

**References**:
- shadcn/ui docs: https://ui.shadcn.com
- Radix UI primitives: https://www.radix-ui.com

---

## 6. Form Validation Strategy

### Decision: Zod + react-hook-form

**Rationale**:
- Zod: TypeScript-first schema validation, aligns with constitution (Type Safety)
- react-hook-form: Minimal re-renders, excellent performance with large forms
- Automatic TypeScript type inference from Zod schemas
- Integrates seamlessly with shadcn/ui Form component
- Runtime validation prevents invalid data in IndexedDB

**Schema Example**:
```typescript
const photoMetadataSchema = z.object({
  patientName: z.string().min(1, "Patient name required").max(100),
  bodyPart: z.enum(['head', 'neck', 'chest', ...]),
  subpart: z.string().max(100).optional(),
  clinicalNotes: z.string().max(2000).optional(),
});
```

**Alternatives Considered**:
- **Yup**: Less TypeScript-friendly, larger bundle
- **Joi**: Server-side focused, not optimized for browser
- **Manual validation**: Error-prone, no type inference

**Best Practices**:
- Define schemas in `lib/validators/schemas.ts`
- Use schema.parse() for server actions (if added later)
- Use schema.safeParse() for client-side with error handling
- Inline error messages below form fields (accessibility)
- Normalize patient name before save (trim, lowercase for search)

**References**:
- Zod documentation: https://zod.dev
- react-hook-form with Zod: https://react-hook-form.com/get-started#SchemaValidation

---

## 7. Virtual Scrolling for Photo Timelines

### Decision: TanStack Virtual (react-virtual)

**Rationale**:
- Handles 1000+ photos in timeline without performance degradation
- Only renders visible items (10-20) + buffer
- Success criteria: 2s load for 50+ photos (meets SC-002)
- Lightweight: 6KB gzipped
- Framework-agnostic, React wrapper available
- Supports variable item heights (photos may vary in aspect ratio)

**Implementation Pattern**:
```tsx
const virtualizer = useVirtualizer({
  count: photos.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 300, // Estimated photo card height
});
```

**Alternatives Considered**:
- **react-window**: Good but less flexible than TanStack Virtual
- **react-virtualized**: Deprecated in favor of react-window
- **No virtualization**: UI freezes with 100+ photos

**Best Practices**:
- Use fixed height containers for stable scrolling
- Implement scroll-to-top button for long timelines
- Maintain scroll position when navigating back from detail view
- Show photo count and current scroll position indicator

**References**:
- TanStack Virtual: https://tanstack.com/virtual/latest
- Virtualization best practices: https://web.dev/virtualize-long-lists-react-window/

---

## 8. Authentication Strategy (v1 Simplification)

### Decision: Simple PIN/Passcode Authentication (localStorage)

**Rationale**:
- Constitution assumption: "Single-user access model" for v1
- No backend required (aligns with IndexedDB-only architecture)
- Passcode stored in localStorage (hashed with Web Crypto API)
- Fast to implement, meets FR-022 (authentication required)
- Can upgrade to OAuth/SSO in v2 if multi-clinician access needed

**Implementation**:
```typescript
// Hash passcode with SHA-256
const hashedPasscode = await crypto.subtle.digest('SHA-256', encoder.encode(passcode));
localStorage.setItem('auth_hash', arrayBufferToHex(hashedPasscode));
```

**Alternatives Considered**:
- **NextAuth.js (Auth.js)**: Over-engineered for single-user, requires backend database
- **Clerk/Supabase Auth**: Vendor dependency, cost, network requirement
- **No authentication**: Violates FR-022 and constitution (security)

**Security Notes**:
- This is NOT HIPAA-compliant security (noted in spec assumptions)
- v2 should implement proper authentication if multi-user or compliance needed
- Passcode complexity requirements: 6+ characters, mix of letters/numbers

**Best Practices**:
- Clear session on browser close (sessionStorage for auth state)
- Auto-logout after 30 minutes of inactivity
- Show security warning about single-user limitation
- Implement "Forgot Passcode" flow (clears all data - user must re-enter)

**References**:
- Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API

---

## 9. Dark Mode Implementation

### Decision: next-themes + Tailwind CSS Dark Mode

**Rationale**:
- Constitution requirement: "Dark mode support REQUIRED"
- next-themes: Lightweight (2KB), prevents FOUC (flash of unstyled content)
- Integrates with Tailwind's `dark:` variant system
- Persists preference in localStorage
- System preference detection (prefers-color-scheme)

**Setup**:
```tsx
// app/layout.tsx
import { ThemeProvider } from 'next-themes'

<ThemeProvider attribute="class" defaultTheme="system">
  {children}
</ThemeProvider>
```

**Color Palette Considerations**:
- Medical imaging often requires neutral backgrounds (avoid color distortion)
- Photo viewers: dark gray (#1a1a1a) instead of pure black
- Metadata text: high contrast (4.5:1) per WCAG AA (constitution)
- UI controls: shadcn/ui dark mode palette (already optimized)

**Alternatives Considered**:
- **Custom implementation**: More work, FOUC issues
- **CSS-only (prefers-color-scheme)**: No user toggle control

**Best Practices**:
- Provide theme toggle in header/settings
- Test photo comparison in both modes (ensure image visibility)
- Use semantic color tokens (not hardcoded colors)

**References**:
- next-themes: https://github.com/pacocoursey/next-themes
- Tailwind dark mode: https://tailwindcss.com/docs/dark-mode

---

## 10. Performance Monitoring

### Decision: Next.js Built-in Analytics + Web Vitals

**Rationale**:
- Next.js exports Web Vitals automatically
- Can hook into onCLS, onFID, onLCP events
- Free for self-hosted deployments
- Meets success criteria: LCP <2.5s, FID <100ms, CLS <0.1

**Implementation**:
```tsx
// app/layout.tsx
export function reportWebVitals(metric: NextWebVitalsMetric) {
  console.log(metric);
  // Can send to analytics service in production
}
```

**Metrics to Monitor**:
- **LCP**: Ensure photo timeline initial render is fast
- **FID**: Camera capture button responsiveness
- **CLS**: Prevent layout shifts during photo loading
- **Custom**: IndexedDB query time, photo compression time

**Alternatives Considered**:
- **Google Analytics**: Privacy concerns for medical data
- **Sentry Performance**: Cost, vendor lock-in
- **Custom logging**: Reinventing the wheel

**Best Practices**:
- Log metrics to console in development
- Set performance budgets (alert if LCP >2.5s)
- Test on 3G throttled network (mobile clinician use case)
- Monitor IndexedDB quota usage

**References**:
- Next.js Web Vitals: https://nextjs.org/docs/advanced-features/measuring-performance
- Web Vitals: https://web.dev/vitals/

---

## Summary of Key Technology Decisions

| Category | Technology | Justification |
|----------|-----------|---------------|
| Camera | MediaDevices API | Native browser support, no dependencies |
| Storage | IndexedDB (via idb library) | Offline-first, large binary support |
| Image Processing | Canvas API | Compression, resize, format conversion |
| UI Library | shadcn/ui + Radix UI | Accessibility, Tailwind integration |
| Forms | react-hook-form + Zod | Performance, type safety |
| Photo Timeline | TanStack Virtual | Handles 1000+ photos |
| Comparison UI | CSS Grid + react-zoom-pan-pinch | Simple, performant |
| Dark Mode | next-themes | FOUC prevention, system preference |
| Auth (v1) | PIN/passcode + Web Crypto | Simple, no backend required |
| Performance | Next.js Web Vitals | Built-in, free |

---

## Open Questions Resolved

All "NEEDS CLARIFICATION" items from plan.md Technical Context have been resolved:

✅ **Language/Version**: TypeScript 5.x, Next.js 15.5.4, React 19
✅ **Primary Dependencies**: shadcn/ui, Zod, react-hook-form, idb, TanStack Virtual
✅ **Storage**: IndexedDB for photos and metadata
✅ **Testing**: Optional per constitution (recommend Vitest + React Testing Library)
✅ **Target Platform**: Modern browsers with MediaDevices API
✅ **Performance Goals**: All metrics defined with implementation strategies
✅ **Constraints**: Offline-capable, HTTPS required, 20MB photo limit
✅ **Scale/Scope**: 1000+ photos per patient, 10K+ total photos

No remaining unknowns. Ready to proceed to Phase 1 (Data Model & Contracts).
