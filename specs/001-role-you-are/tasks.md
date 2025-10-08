---
description: "Task list for Clinical Photo Documentation System implementation"
---

# Tasks: Clinical Photo Documentation System

**Feature Branch**: `001-role-you-are`
**Input**: Design documents from `/specs/001-role-you-are/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL per project constitution. Not included in this task list.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- All paths shown are absolute from repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Install dependencies: `npx shadcn@latest init` and configure with Default style, Slate color, CSS variables
- [X] T002 [P] Install shadcn/ui components: `npx shadcn@latest add button card dialog form input textarea select label toast badge combobox skeleton scroll-area`
- [X] T003 [P] Install additional dependencies: `npm install zod react-hook-form @hookform/resolvers idb @tanstack/react-virtual react-zoom-pan-pinch next-themes uuid @types/uuid date-fns`
- [X] T004 [P] Create directory structure: `mkdir -p types lib/{db,services,hooks,validators,utils} components/{camera,photo,patient,layout} app/{(auth)/login,(dashboard)/{capture,patients,search}}`
- [X] T005 [P] Create type definition files: `types/{index,photo,patient,body-part,clinician,subpart}.ts`
- [X] T006 [P] Configure dark mode: Update `app/layout.tsx` with ThemeProvider from next-themes
- [X] T007 Verify setup checkpoint: Run `npm run dev` and confirm no errors

**Checkpoint**: All dependencies installed, directory structure created, dev server runs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data layer and validation that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 [P] Define TypeScript types: Copy PhotoRecord, Patient, BodyPart enum, Clinician, SubpartSuggestion from data-model.md to respective type files in `types/`
- [X] T009 [P] Create Zod validation schemas in `lib/validators/schemas.ts`: photoRecordCreateSchema, photoRecordUpdateSchema, patientCreateSchema, patientUpdateSchema, clinicianRegisterSchema, clinicianLoginSchema (from data-model.md)
- [X] T010 Create IndexedDB schema in `lib/db/schema.ts`: Define DB_NAME, DB_VERSION, STORES constants
- [X] T011 Create IndexedDB wrapper in `lib/db/indexeddb.ts`: Implement getDB() function with all 4 stores (photos, patients, subparts, clinicians) and indexes from data-model.md using idb library
- [X] T012 Verify IndexedDB: Open browser DevTools → Application → IndexedDB and confirm 4 stores exist with correct indexes
- [X] T013 [P] Create error classes in `lib/validators/errors.ts`: NotFoundError, ValidationError, StorageQuotaError, PermissionDeniedError, NotSupportedError, DuplicateWarning, InvalidCredentialsError, AlreadyExistsError, SessionExpiredError, NotAuthenticatedError, ConfirmationError

**Checkpoint**: Foundation ready - TypeScript types defined, IndexedDB operational, validation schemas ready

---

## Phase 3: User Story 1 - Capture and Document Patient Photo (Priority: P1) 🎯 MVP

**Goal**: Clinicians can capture a photo via camera/webcam, fill in patient name, select body part, enter subpart, add clinical notes, and save the record with a unique identifier.

**Independent Test**: Take a photo, fill required patient name field, select body part, optionally enter subpart and notes, save, and verify record exists in IndexedDB with all metadata. Can immediately capture another photo or view the saved record.

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement CameraService in `lib/services/camera-service.ts`: isSupported(), checkPermission(), startCamera(), stopCamera(), capturePhoto(), compressPhoto(), generateThumbnail() methods per camera-service.ts contract
- [X] T015 [P] [US1] Implement PhotoService.createPhoto() in `lib/services/photo-service.ts`: Validate data, compress photo, generate thumbnail, create transaction, update patient denormalized counts, handle SubpartSuggestion usage
- [X] T016 [P] [US1] Implement PatientService in `lib/services/patient-service.ts`: createPatient(), getPatientById(), updatePhotoCount() methods (needed by PhotoService)
- [X] T017 [P] [US1] Implement SubpartService.recordUsage() in `lib/services/subpart-service.ts`: Create or update SubpartSuggestion with usageCount and lastUsedAt
- [X] T018 [P] [US1] Create useCamera hook in `lib/hooks/use-camera.ts`: Manage MediaStream state, permission state, error state, start/stop functions, cleanup on unmount
- [X] T019 [P] [US1] Create image processing utilities in `lib/utils/image-processing.ts`: compressImage(), generateThumbnail(), blobToDataUrl() helpers
- [ ] T020 [US1] Create CameraCapture component in `components/camera/camera-capture.tsx`: Video preview, capture button, integrate useCamera hook, handle permission errors
- [ ] T021 [US1] Create PhotoMetadataForm component in `components/photo/photo-metadata-form.tsx`: Form with patient name (required), body part select, subpart input, clinical notes textarea, use react-hook-form + Zod validation
- [ ] T022 [US1] Create capture page in `app/(dashboard)/capture/page.tsx`: Compose CameraCapture + PhotoMetadataForm, handle save flow, success/error toast notifications
- [ ] T023 [US1] Add loading states: Implement skeleton loaders and Suspense boundaries for camera initialization and photo save operation
- [ ] T024 [US1] Add error handling: Camera permission denied UI, storage quota exceeded warning, invalid file format validation errors

**Checkpoint**: User Story 1 fully functional - can capture photos with metadata, save to IndexedDB, receive confirmation

---

## Phase 4: User Story 2 - View Patient Timeline (Priority: P2)

**Goal**: Clinicians can search for or select a patient and view all their photos in chronological order (newest first) with associated metadata. Can filter timeline by body part.

**Independent Test**: Create multiple photos for a patient (using US1), then view patient timeline showing all photos ordered by capture date with metadata visible. Apply body part filter and verify filtering works. Empty state shows when no photos exist.

### Implementation for User Story 2

- [ ] T025 [P] [US2] Implement PhotoService.getPhotosByPatient() in `lib/services/photo-service.ts`: Indexed query with includeDeleted and bodyPart filter options, sort by capturedAt DESC
- [ ] T026 [P] [US2] Implement PatientService methods in `lib/services/patient-service.ts`: getAllPatients(), searchPatients() with normalized name search
- [ ] T027 [P] [US2] Create usePhotos hook in `lib/hooks/use-photos.ts`: Load photos for patient, handle loading state, refresh on data changes
- [ ] T028 [P] [US2] Create usePatients hook in `lib/hooks/use-patients.ts`: Load patient list, search functionality, loading state
- [ ] T029 [P] [US2] Create PhotoCard component in `components/photo/photo-card.tsx`: Display photo thumbnail, capture date, body part, subpart, clinical notes preview
- [ ] T030 [US2] Create PhotoTimeline component in `components/photo/photo-timeline.tsx`: Use TanStack Virtual for virtualization, render PhotoCard items, handle body part filter, empty state for no photos
- [ ] T031 [P] [US2] Create PatientCard component in `components/patient/patient-card.tsx`: Display patient name, photo count, last photo timestamp, click to view timeline
- [ ] T032 [P] [US2] Create PatientList component in `components/patient/patient-list.tsx`: Render patient cards, implement search box, integrate usePatients hook
- [ ] T033 [US2] Create patients list page in `app/(dashboard)/patients/page.tsx`: Display PatientList component with search functionality
- [ ] T034 [US2] Create patient timeline page in `app/(dashboard)/patients/[id]/page.tsx`: Display PhotoTimeline for selected patient, body part filter dropdown, back navigation
- [ ] T035 [US2] Add virtual scrolling performance: Configure TanStack Virtual estimateSize, implement scroll restoration on navigation back
- [ ] T036 [US2] Implement thumbnail loading: PhotoCard uses imageThumbnail blob, lazy load full resolution on demand

**Checkpoint**: User Story 2 fully functional - can search/select patients, view chronological timelines, filter by body part, see empty states

---

## Phase 5: User Story 3 - Compare Photos Side-by-Side (Priority: P3)

**Goal**: Clinicians can select 2-4 photos from a patient's timeline and view them side-by-side with synchronized zoom/pan. Overlay mode with adjustable transparency is available. Photos scale to fit viewport while maintaining aspect ratio.

**Independent Test**: Select 2-4 photos from timeline, open comparison view, verify side-by-side display with capture dates labeled. Test synchronized zoom, switch to overlay mode with transparency slider, verify aspect ratio preservation for different resolutions.

### Implementation for User Story 3

- [ ] T037 [P] [US3] Implement PhotoService.getPhotosForComparison() in `lib/services/photo-service.ts`: Validate 2-4 photo IDs, fetch in requested order, return full resolution images
- [ ] T038 [P] [US3] Create PhotoViewer component in `components/photo/photo-viewer.tsx`: Single photo display with zoom controls, integrate react-zoom-pan-pinch
- [ ] T039 [US3] Create PhotoComparison component in `components/photo/photo-comparison.tsx`: CSS Grid layout for side-by-side (2-4 columns), synchronized zoom state via React context, aspect ratio preservation
- [ ] T040 [US3] Create OverlayComparison component in `components/photo/photo-overlay.tsx`: Canvas-based overlay with two layers, adjustable opacity slider (0-100%), image alignment/scaling
- [ ] T041 [US3] Add comparison selection UI to PhotoTimeline: Multi-select checkboxes on PhotoCard, "Compare" button enabled when 2-4 photos selected, validation error for invalid selections
- [ ] T042 [US3] Create comparison page in `app/(dashboard)/patients/[id]/compare/page.tsx`: Parse photoIds from URL params, fetch photos, render PhotoComparison or OverlayComparison based on view mode toggle
- [ ] T043 [US3] Implement synchronized zoom: Create shared zoom context, connect all PhotoViewer instances, debounce zoom/pan events for performance
- [ ] T044 [US3] Add keyboard navigation: Arrow keys to navigate between photos, +/- keys for zoom, Esc to exit comparison, focus indicators for accessibility
- [ ] T045 [US3] Add metadata overlay: Display capture date on each photo in comparison view, ARIA labels for screen readers

**Checkpoint**: User Story 3 fully functional - can select and compare 2-4 photos, synchronized zoom works, overlay mode functional, keyboard accessible

---

## Phase 6: User Story 4 - Manage Body Part Subparts (Priority: P4)

**Goal**: Clinicians can see previously defined subparts as autocomplete suggestions when selecting a body part during photo capture. New subpart entries are automatically added to autocomplete for future use.

**Independent Test**: When capturing a photo and selecting a body part, autocomplete shows previously used subparts. Enter a new subpart and save photo, then verify it appears in autocomplete for next photo of same body part. Subparts are specific to each body part.

### Implementation for User Story 4

- [ ] T046 [P] [US4] Implement SubpartService remaining methods in `lib/services/subpart-service.ts`: getSuggestionsForBodyPart(), searchSuggestions() with usageCount DESC, lastUsedAt DESC sorting
- [ ] T047 [P] [US4] Create useSubpartSuggestions hook in `lib/hooks/use-subpart-suggestions.ts`: Load suggestions for body part, filter on search term, handle loading state
- [ ] T048 [US4] Update PhotoMetadataForm in `components/photo/photo-metadata-form.tsx`: Replace subpart input with Combobox component, integrate useSubpartSuggestions hook, filter suggestions as user types
- [ ] T049 [US4] Implement autocomplete performance: Debounce search input (300ms), limit suggestions to top 10, cache recent queries in hook state
- [ ] T050 [US4] Add keyboard navigation to Combobox: Arrow keys to navigate suggestions, Enter to select, Tab to next field, Esc to close dropdown

**Checkpoint**: User Story 4 fully functional - autocomplete suggestions appear on body part selection, new subparts saved and reused, keyboard navigable

---

## Phase 7: User Story 5 - Search and Filter Records (Priority: P5)

**Goal**: Clinicians can search for photos across all patients by patient name, body part, date range, or keywords in clinical notes. Results show all matching photos with photo counts.

**Independent Test**: Create photos with various patient names, body parts, and notes. Search by patient name and verify matching patients appear with photo counts. Filter by body part or date range and verify accurate results. Search clinical notes keywords and verify matching photos. Empty state when no matches.

### Implementation for User Story 5

- [ ] T051 [P] [US5] Implement PhotoService.searchPhotosByNotes() in `lib/services/photo-service.ts`: O(n) scan with case-insensitive keyword matching, optional patientId and bodyPart filters
- [ ] T052 [P] [US5] Implement date range filtering in PhotoService: Add getPhotosByDateRange() method with capturedAt index query
- [ ] T053 [P] [US5] Create SearchFilters component in `components/photo/search-filters.tsx`: Patient name input, body part select, date range pickers, clinical notes keyword input
- [ ] T054 [P] [US5] Create SearchResults component in `components/photo/search-results.tsx`: Display matching photos across patients, group by patient, show photo counts, virtual scrolling for performance
- [ ] T055 [US5] Create search page in `app/(dashboard)/search/page.tsx`: Compose SearchFilters + SearchResults, debounce search input (500ms), handle empty state
- [ ] T056 [US5] Add global search to header: Search box in `components/layout/header.tsx` that navigates to search page with pre-filled query
- [ ] T057 [US5] Optimize search performance: Index clinical notes field, implement cursor-based pagination for large result sets, show search result count

**Checkpoint**: User Story 5 fully functional - can search by patient name, filter by body part/date range, search clinical notes, view results across patients

---

## Phase 8: Authentication & Session Management (Cross-Story Requirement)

**Purpose**: Authentication layer required by all user stories (FR-022)

- [ ] T058 [P] Implement AuthService in `lib/services/auth-service.ts`: register(), login(), logout(), getCurrentSession(), isAuthenticated(), refreshSession(), changePasscode(), resetApp() per auth-service.ts contract
- [ ] T059 [P] Implement SHA-256 hashing utility in `lib/utils/crypto.ts`: hashPasscode() using Web Crypto API
- [ ] T060 [P] Create session management utilities in `lib/utils/session.ts`: storeSession(), getSession(), clearSession() using sessionStorage
- [ ] T061 [P] Create useAuth hook in `lib/hooks/use-auth.ts`: Manage authentication state, auto-refresh session on activity, handle session expiry
- [ ] T062 [US] Create login page in `app/(auth)/login/page.tsx`: Login form with username and passcode, validation, error states, redirect to capture page on success
- [ ] T063 [P] [AUTH] Create registration page in `app/(auth)/register/page.tsx`: First-time setup form with username, passcode (6+ chars, letters+numbers), display name
- [ ] T064 [AUTH] Create auth guard middleware in `middleware.ts`: Check session on route changes, redirect to login if not authenticated, refresh session on activity
- [ ] T065 [AUTH] Implement auto-logout: 30-minute session timeout, show warning at 28 minutes, extend session on user activity (click, keypress)
- [ ] T066 [AUTH] Create settings page in `app/(dashboard)/settings/page.tsx`: Change passcode form, reset app with confirmation ("DELETE ALL DATA"), theme preferences

**Checkpoint**: Authentication complete - registration works, login works, session management functional, auth guards protect routes

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T067 [P] Create shared layout in `components/layout/header.tsx`: Navigation links, theme toggle, user profile dropdown, logout button
- [ ] T068 [P] Create shared layout in `components/layout/sidebar.tsx`: Quick access to capture, patients, search pages
- [ ] T069 [P] Update root layout in `app/layout.tsx`: Include header, sidebar, toast provider, error boundary
- [ ] T070 [P] Implement dark mode color palette: Medical imaging-appropriate colors (dark gray #1a1a1a for photo viewers, high contrast text 4.5:1)
- [ ] T071 [P] Add date formatting utilities in `lib/utils/date-formatting.ts`: formatCaptureDate(), formatTimelineDate(), relative time for "last photo at"
- [ ] T072 [P] Implement error boundaries in `app/error.tsx` and `app/global-error.tsx`: Catch camera failures, IndexedDB errors, show actionable error messages
- [ ] T073 [P] Add loading states: Create skeleton loaders in `components/ui/skeleton.tsx` for timeline, patient list, comparison view
- [ ] T074 [P] Optimize bundle size: Implement dynamic imports for comparison page, camera page to reduce initial load
- [ ] T075 [P] Add accessibility: Run axe DevTools, fix violations, test keyboard navigation (Tab, Enter, Esc), add ARIA labels to camera controls
- [ ] T076 [P] Implement toast notifications: Success on photo save, error on permission denied, warning on storage quota low
- [ ] T077 [P] Add responsive design: Mobile-first CSS for camera capture (primary use case), responsive grid for comparison view (vertical stack on mobile)
- [ ] T078 [P] Performance monitoring: Implement reportWebVitals in `app/layout.tsx`, log LCP, FID, CLS to console in dev mode
- [ ] T079 [P] Add storage quota monitoring: Check `navigator.storage.estimate()` periodically, warn user at 90% capacity
- [ ] T080 [P] Create empty states: EmptyTimeline component for patients with no photos, EmptyPatientList for no patients, EmptySearchResults
- [ ] T081 Code cleanup: Remove console.logs, fix ESLint warnings, format with Prettier
- [ ] T082 Run build validation: `npm run build` succeeds with no errors, verify Core Web Vitals in Lighthouse (LCP <2.5s, FID <100ms, CLS <0.1)

**Checkpoint**: All polish complete - accessible, performant, production-ready build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2)
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) + partial US1 (Patient and Photo services)
- **User Story 3 (Phase 5)**: Depends on Foundational (Phase 2) + US2 (PhotoTimeline for selection)
- **User Story 4 (Phase 6)**: Depends on Foundational (Phase 2) + US1 (PhotoMetadataForm)
- **User Story 5 (Phase 7)**: Depends on Foundational (Phase 2) + US1, US2 (Photo and Patient services)
- **Authentication (Phase 8)**: Depends on Foundational (Phase 2) - should complete before deploying any user story
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Foundation complete → Can start immediately → **MVP DELIVERY**
- **User Story 2 (P2)**: Foundation + Patient/Photo services from US1 → Can test independently
- **User Story 3 (P3)**: Foundation + PhotoTimeline from US2 → Can test independently
- **User Story 4 (P4)**: Foundation + PhotoMetadataForm from US1 → Can test independently
- **User Story 5 (P5)**: Foundation + services from US1/US2 → Can test independently

### Within Each User Story

- Services before hooks
- Hooks before components
- Components before pages
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 1 (Setup)**: T002, T003, T004, T005, T006 can run in parallel

**Phase 2 (Foundational)**: T008, T009, T013 can run in parallel after T010-T012

**Phase 3 (US1)**: T014, T015, T016, T017, T018, T019 can run in parallel (all different files)

**Phase 4 (US2)**: T025, T026, T027, T028, T029, T031, T032 can run in parallel

**Phase 5 (US3)**: T037, T038 can run in parallel

**Phase 6 (US4)**: T046, T047 can run in parallel

**Phase 7 (US5)**: T051, T052, T053, T054 can run in parallel

**Phase 8 (Auth)**: T058, T059, T060, T061, T062, T063 can run in parallel

**Phase 9 (Polish)**: Most polish tasks (T067-T080) can run in parallel

---

## Parallel Example: User Story 1 Services

```bash
# Launch all service implementations for US1 together:
# Each task works on a different file, no dependencies between them

Task T014: "Implement CameraService in lib/services/camera-service.ts"
Task T015: "Implement PhotoService.createPhoto() in lib/services/photo-service.ts"
Task T016: "Implement PatientService in lib/services/patient-service.ts"
Task T017: "Implement SubpartService.recordUsage() in lib/services/subpart-service.ts"
Task T018: "Create useCamera hook in lib/hooks/use-camera.ts"
Task T019: "Create image processing utilities in lib/utils/image-processing.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T007)
2. Complete Phase 2: Foundational (T008-T013) - **CRITICAL BLOCKER**
3. Complete Phase 3: User Story 1 (T014-T024)
4. Complete Phase 8: Authentication (T058-T066) - Required for deployment
5. **STOP and VALIDATE**: Test photo capture workflow end-to-end
6. Minimal polish from Phase 9 (error boundaries, loading states)
7. Deploy MVP - Clinicians can capture and save photos with metadata

**MVP Task Count**: ~40 tasks
**Estimated Time**: 12-15 hours (based on quickstart.md estimates)

### Incremental Delivery (Recommended)

1. **Sprint 1** - Foundation + Auth + US1 (MVP)
   - Setup (Phase 1) → 2 hours
   - Foundational (Phase 2) → 2 hours
   - User Story 1 (Phase 3) → 6 hours
   - Authentication (Phase 8) → 3 hours
   - **Deploy**: Photo capture and save

2. **Sprint 2** - Timeline Viewing (US2)
   - User Story 2 (Phase 4) → 4 hours
   - **Deploy**: View patient timelines

3. **Sprint 3** - Comparison & Subparts (US3 + US4)
   - User Story 3 (Phase 5) → 3 hours
   - User Story 4 (Phase 6) → 2 hours
   - **Deploy**: Side-by-side comparison, autocomplete

4. **Sprint 4** - Search & Polish (US5 + Phase 9)
   - User Story 5 (Phase 7) → 2 hours
   - Polish (Phase 9) → 3 hours
   - **Deploy**: Full feature set, production-ready

### Parallel Team Strategy

With 3 developers after Foundational phase completes:

- **Developer A**: User Story 1 + Authentication (critical path)
- **Developer B**: User Story 2 (timeline viewing)
- **Developer C**: User Story 4 (subpart autocomplete - smaller scope)

Then integrate:
- **Developer A**: User Story 3 (depends on US2 timeline)
- **Developer B**: User Story 5 (depends on US1/US2 services)
- **Developer C**: Polish & accessibility

---

## Summary

**Total Task Count**: 82 tasks

**Task Breakdown by Phase**:
- Setup: 7 tasks
- Foundational: 6 tasks (CRITICAL - blocks all stories)
- User Story 1 (P1 - MVP): 11 tasks
- User Story 2 (P2): 12 tasks
- User Story 3 (P3): 9 tasks
- User Story 4 (P4): 5 tasks
- User Story 5 (P5): 7 tasks
- Authentication: 9 tasks
- Polish: 16 tasks

**Parallel Opportunities**: 45 tasks marked [P] can run in parallel within their phase

**Independent Test Criteria**:
- US1: Capture photo + save metadata → Verify in IndexedDB
- US2: View patient timeline → See all photos chronologically
- US3: Select 2-4 photos → View side-by-side with zoom
- US4: Select body part → See autocomplete suggestions
- US5: Search by name/notes → See matching results

**Suggested MVP Scope**: Setup + Foundational + US1 + Auth (~40 tasks, 12-15 hours)

**Full Feature Estimate**: 82 tasks, 25-30 hours for complete implementation

**Critical Path**:
1. Setup (cannot skip)
2. Foundational (blocks everything)
3. User Story 1 (MVP core value)
4. Authentication (required for deployment)
5. User Story 2+ (incremental value)

---

## Notes

- All file paths are relative to repository root
- [P] tasks = different files, safe for parallel execution
- [Story] labels map each task to a user story for traceability
- Each user story can be independently implemented and tested
- Stop at any checkpoint to validate story works before proceeding
- Commit after each task or logical task group
- Tests were not included per project constitution (optional testing policy)
- IndexedDB operations are asynchronous - ensure proper error handling
- Camera API requires HTTPS or localhost for permission grants
- Virtual scrolling is critical for performance with 1000+ photos
- All success criteria from spec.md are addressed by these tasks
