# Technical Research: Dermatology Photo Organization System

## Research Summary
This document consolidates technical research for building an offline dermatology photo organization system using Vite with minimal dependencies and vanilla web technologies.

## Camera Integration Research

### Decision: File System Access API + getUserMedia API
**Rationale**:
- getUserMedia API provides direct camera access in modern browsers
- File System Access API allows saving photos directly to user's file system
- Both APIs work offline and require no external dependencies
- Compatible with PWA requirements for offline operation

**Alternatives Considered**:
- Electron with native camera APIs: More complex, larger bundle size
- WebRTC MediaRecorder: Good for video, overkill for still photos
- Input file upload: Requires user to manually take photos outside app

**Implementation Notes**:
- Fallback to `<input type="file" capture="camera">` for unsupported browsers
- Progressive enhancement for File System Access API availability
- Canvas API for image processing and compression

## Local Storage Research

### Decision: IndexedDB for metadata + File System Access API for photos
**Rationale**:
- IndexedDB provides robust offline database with complex queries
- Can store patient metadata, body part classifications, photo references
- File System Access API stores actual photo files in user-chosen directory
- Separation allows for efficient metadata queries without loading large photos

**Alternatives Considered**:
- LocalStorage: Too limited (5-10MB), no complex querying
- WebSQL: Deprecated standard
- SQLite WASM: Adds significant bundle size, complex setup

**Implementation Notes**:
- Dexie.js wrapper for IndexedDB to simplify API (minimal additional dependency)
- JSON schema for patient and photo metadata
- Reference photos by file path/name in metadata

## Component Architecture Research

### Decision: shadcn/ui with custom extensions
**Rationale**:
- shadcn/ui provides TypeScript-first, accessible components
- Copy-paste approach aligns with minimal dependency requirement
- Built on Radix UI primitives with excellent accessibility
- Tailwind CSS for styling maintains performance budget

**Alternatives Considered**:
- Vanilla components: More development time, accessibility concerns
- Material UI/Ant Design: Too heavy, many unnecessary dependencies
- Custom CSS framework: Reinventing the wheel

**Implementation Notes**:
- Use shadcn/ui CLI to add only needed components
- Custom components for domain-specific functionality (photo tiles, body part navigation)
- CSS modules for component-specific styles

## Photo Processing Research

### Decision: Canvas API for client-side image processing
**Rationale**:
- Resize images for thumbnail generation and storage optimization
- EXIF data extraction for photo metadata
- Image compression to manage storage space
- All processing happens client-side maintaining offline capability

**Alternatives Considered**:
- Server-side processing: Conflicts with offline requirement
- Third-party image libraries: Adds bundle size
- No processing: Wastes storage space with large photos

**Implementation Notes**:
- Canvas for resize/compress operations
- FileReader API for loading images
- Blob API for creating processed image files

## PDF Export Research

### Decision: jsPDF with custom layout engine
**Rationale**:
- Pure JavaScript library, works offline
- Supports image embedding for photo reports
- Customizable layouts for medical report formatting
- Small bundle size impact (~100KB)

**Alternatives Considered**:
- Browser print API: Limited layout control
- Server-side PDF generation: Conflicts with offline requirement
- Canvas-to-PDF: Complex implementation for multi-page reports

**Implementation Notes**:
- Custom templates for dermatology report formats
- Image optimization before PDF embedding
- Progressive loading for large photo collections

## Performance Optimization Research

### Decision: Virtual scrolling + lazy image loading
**Rationale**:
- Large photo collections can impact performance
- Virtual scrolling handles thousands of photos efficiently
- Lazy loading reduces initial page load time
- Thumbnail generation improves perceived performance

**Alternatives Considered**:
- Pagination: Poor UX for medical photo browsing
- Load all images: Memory and performance issues
- Server-side thumbnails: Conflicts with offline requirement

**Implementation Notes**:
- Intersection Observer for lazy loading
- RequestIdleCallback for background thumbnail generation
- Service Worker for offline caching strategy

## Accessibility Research

### Decision: WCAG 2.1 AA compliance with screen reader optimization
**Rationale**:
- Medical applications must be accessible to all users
- Proper ARIA labels for photo metadata and navigation
- Keyboard navigation for all functionality
- High contrast support for visual impairments

**Implementation Notes**:
- Semantic HTML structure
- Role attributes for custom components
- Focus management for modal interactions
- Alt text generation for medical photos

## Offline Strategy Research

### Decision: Service Worker with Cache-First strategy
**Rationale**:
- Application must work completely offline
- Cache-first ensures instant loading
- Background sync for any future cloud features
- PWA capabilities for desktop installation

**Implementation Notes**:
- Workbox for service worker management
- App shell caching pattern
- Dynamic caching for user photos and data
- Update notifications for app changes

## Build Tool Research

### Decision: Vite with TypeScript and PWA plugin
**Rationale**:
- Fast development server and build times
- Excellent TypeScript support
- PWA plugin for offline capabilities
- Tree-shaking reduces bundle size
- Modern JavaScript features with browser compatibility

**Implementation Notes**:
- Vite PWA plugin for service worker generation
- TypeScript strict mode for type safety
- ESLint and Prettier for code quality
- Bundle analysis to maintain size budgets

## Testing Strategy Research

### Decision: Vitest + Playwright + Testing Library
**Rationale**:
- Vitest integrates perfectly with Vite
- Playwright for cross-browser E2E testing
- Testing Library for component testing
- All tools support TypeScript out of the box

**Implementation Notes**:
- Unit tests for business logic and utilities
- Component tests for user interactions
- E2E tests for complete user workflows
- Visual regression testing for UI consistency

## Security and Privacy Research

### Decision: Client-side only with no network communication
**Rationale**:
- Medical data privacy requires no external communication
- All processing happens locally
- User controls all data storage locations
- No telemetry or analytics

**Implementation Notes**:
- Content Security Policy headers
- No external API calls
- User-controlled data export only
- HIPAA-conscious development practices