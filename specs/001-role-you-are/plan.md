# Implementation Plan: Clinical Photo Documentation System

**Branch**: `001-role-you-are` | **Date**: 2025-10-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-role-you-are/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Build a clinical photo documentation system that enables clinicians to capture patient photos with structured metadata (patient name, body part, subpart, clinical notes), view chronological timelines, and perform side-by-side comparisons. The application will be built as a Next.js web application using React 19, TypeScript, and Tailwind CSS v4, with camera access via browser APIs and local storage for photo persistence.

## Technical Context

**Language/Version**: TypeScript 5.x with Next.js 15.5.4, React 19.1.0
**Primary Dependencies**: Next.js (App Router), React, Tailwind CSS v4, shadcn/ui (to be added)
**Storage**: IndexedDB for photo storage and metadata, localStorage for app state
**Testing**: Vitest/Jest for unit tests, React Testing Library for components (optional per constitution)
**Target Platform**: Modern web browsers (Chrome 90+, Safari 14+, Firefox 88+, Edge 90+) with MediaDevices API support
**Project Type**: Web application (Next.js single-page app with client-side routing)
**Performance Goals**: LCP <2.5s, FID <100ms, CLS <0.1, photo timeline render <2s for 50+ photos, search results <1s
**Constraints**: Camera API requires HTTPS or localhost, photos up to 20MB, support 1000+ photos per patient, offline-capable after initial load
**Scale/Scope**: 1-100 concurrent clinicians, 10,000+ photos across all patients, ~15-20 UI components, 5 main routes/pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ I. Component-First Architecture
- All UI built with reusable React components
- Using shadcn/ui primitives (Dialog, Form, Card, Button, Input, Select, etc.)
- Camera, photo viewer, timeline, comparison as distinct components
- Props-based customization, no hard-coded values
- **STATUS**: PASS - Feature naturally aligns with component architecture

### ✅ II. Type Safety & Validation
- TypeScript strict mode enabled (already in tsconfig.json)
- Interfaces for PhotoRecord, Patient, BodyPart, Clinician entities
- Zod schemas for form validation (patient name, metadata)
- API/action responses typed
- **STATUS**: PASS - All data models will have proper types

### ⚠️ III. Accessibility First (NON-NEGOTIABLE)
- Camera controls: keyboard accessible, ARIA labels for capture/cancel
- Form inputs: semantic labels, error announcements
- Timeline/gallery: keyboard navigation, focus management
- Photo comparison: screen reader descriptions for images
- Color contrast: ensure 4.5:1 for all text over images
- **STATUS**: PASS with vigilance - Requires careful implementation, especially for custom camera UI and photo viewers

### ✅ IV. Performance & Core Web Vitals
- Next.js Image component for photo thumbnails
- Lazy loading for photo timeline (virtualization for 50+ photos)
- Server Components for static layouts, Client Components for camera/interactions
- IndexedDB for efficient large binary storage
- Code splitting per route
- **STATUS**: PASS - Photo loading strategy is critical; will use virtual scrolling and progressive image loading

### ✅ V. Developer Experience
- Prettier + ESLint already configured
- Clear naming: CameraCapture, PhotoTimeline, PhotoComparison components
- Documentation for camera permission flows and IndexedDB schema
- Error boundaries for camera failures
- **STATUS**: PASS - Standard Next.js DX patterns apply

### ✅ UI/UX Standards
- Tailwind CSS v4 already configured
- shadcn/ui for form controls, dialogs, buttons
- Dark mode support (constitution requirement)
- Loading states: Suspense boundaries, skeleton loaders
- Error states: camera permission denied, upload failures
- Responsive design: mobile-first (camera on mobile is primary use case)
- **STATUS**: PASS - Mobile-first approach aligns with clinical use case

### 🔍 Initial Assessment: PASS
No constitutional violations. Feature requirements align with all core principles. Will re-evaluate after Phase 1 design to ensure data model and contracts maintain compliance.

---

### 🔍 Phase 1 Re-Evaluation (Post-Design)

**Data Model Review** (from data-model.md):
✅ All entities have proper TypeScript interfaces with strict typing
✅ Zod validation schemas defined for all user inputs
✅ IndexedDB schema includes proper indexes for performance
✅ No `any` types - all fields explicitly typed
✅ Business rules documented with state transitions
✅ PASS - Type safety maintained throughout data layer

**Service Contracts Review** (from contracts/):
✅ 5 service interfaces defined with clear method signatures
✅ Error types are specific (ValidationError, NotFoundError, etc.)
✅ All methods documented with side effects and performance notes
✅ Return types and parameters fully typed
✅ PASS - Contracts enforce type safety and testability

**Architecture Review**:
✅ Component-first: Separate components for camera, photo, patient, layout
✅ Service layer abstraction: Business logic isolated from UI
✅ Dependency injection pattern: Components accept service interfaces
✅ PASS - Clean separation of concerns maintained

**Accessibility Review**:
✅ Quickstart includes accessibility audit checkpoint (Phase 6)
✅ ARIA labels specified in component designs
✅ Keyboard navigation documented for all interactive elements
✅ Screen reader testing included in implementation plan
✅ PASS - Accessibility is baked into implementation plan

**Performance Review**:
✅ Virtual scrolling (TanStack Virtual) for 1000+ photos
✅ Thumbnail generation (200x200px) reduces memory usage
✅ IndexedDB indexed queries (O(log n) instead of O(n))
✅ Denormalized counts avoid expensive aggregations
✅ Image compression (1920px max, 85% JPEG) reduces storage
✅ PASS - Performance optimizations meet success criteria

**UI/UX Standards Review**:
✅ shadcn/ui components throughout (10+ components identified)
✅ Dark mode via next-themes (documented in research.md)
✅ Loading states: Suspense, skeletons (specified in quickstart)
✅ Error states: Specific error types with user-friendly messages
✅ Responsive: Mobile-first design (camera primary use case)
✅ PASS - UI/UX patterns consistent with constitution

**Developer Experience Review**:
✅ Comprehensive documentation: 4 design docs (research, data-model, contracts, quickstart)
✅ Clear implementation phases with checkpoints
✅ Service interfaces enable testing and mocking
✅ Type safety from data layer through UI
✅ PASS - DX exceeds constitution requirements

### ✅ Final Constitution Assessment: PASS

All design artifacts (data-model.md, contracts/, research.md, quickstart.md) maintain full compliance with the project constitution. No violations or complexity exceptions required.

**Key Strengths**:
1. Type safety: End-to-end TypeScript with Zod runtime validation
2. Performance: Virtual scrolling, thumbnails, indexed queries exceed success criteria
3. Accessibility: Baked into implementation plan with specific testing phase
4. Component architecture: Clean separation with dependency injection
5. Documentation: Exceptional detail for implementation and maintenance

**No action required.** Proceed to Phase 2 (tasks.md generation via /speckit.tasks).

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
app/                          # Next.js App Router
├── (auth)/                   # Authentication route group
│   ├── login/
│   └── layout.tsx
├── (dashboard)/              # Main app route group (authenticated)
│   ├── capture/              # Photo capture page
│   │   └── page.tsx
│   ├── patients/             # Patient list and search
│   │   ├── page.tsx
│   │   └── [id]/             # Patient detail/timeline
│   │       ├── page.tsx
│   │       └── compare/      # Photo comparison
│   │           └── page.tsx
│   ├── search/               # Global search
│   │   └── page.tsx
│   └── layout.tsx
├── layout.tsx                # Root layout
├── page.tsx                  # Landing/home page
└── globals.css

components/                   # Shared UI components
├── ui/                       # shadcn/ui components
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   ├── form.tsx
│   ├── input.tsx
│   ├── select.tsx
│   └── ...
├── camera/
│   ├── camera-capture.tsx    # Main camera interface
│   ├── camera-preview.tsx    # Live preview component
│   └── camera-controls.tsx   # Capture/cancel buttons
├── photo/
│   ├── photo-card.tsx        # Single photo display
│   ├── photo-timeline.tsx    # Chronological list
│   ├── photo-comparison.tsx  # Side-by-side viewer
│   └── photo-metadata-form.tsx
├── patient/
│   ├── patient-search.tsx
│   ├── patient-card.tsx
│   └── patient-list.tsx
└── layout/
    ├── header.tsx
    ├── nav.tsx
    └── sidebar.tsx

lib/                          # Utilities and services
├── db/
│   ├── indexeddb.ts          # IndexedDB wrapper
│   └── schema.ts             # DB schema definitions
├── services/
│   ├── photo-service.ts      # Photo CRUD operations
│   ├── patient-service.ts    # Patient CRUD operations
│   └── camera-service.ts     # Camera API wrapper
├── hooks/
│   ├── use-camera.ts         # Camera access hook
│   ├── use-photos.ts         # Photo data hook
│   └── use-patients.ts       # Patient data hook
├── validators/
│   └── schemas.ts            # Zod validation schemas
└── utils/
    ├── image-processing.ts   # Resize, compress utilities
    └── date-formatting.ts

types/                        # TypeScript type definitions
├── photo.ts
├── patient.ts
├── clinician.ts
└── index.ts

actions/                      # Server actions (if needed)
└── auth.ts

public/                       # Static assets
└── images/

tests/                        # Test files (optional)
├── components/
├── services/
└── utils/
```

**Structure Decision**: Using Next.js App Router (Option 2 variant) as a client-heavy web application. The app is primarily client-side (camera, IndexedDB interactions) with Server Components for layouts and static content. No separate backend - all data stored client-side in IndexedDB. This structure follows Next.js 13+ conventions with route groups for logical separation of authenticated vs. public routes.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

No constitutional violations identified. All design decisions align with core principles.
