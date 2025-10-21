# Project Context

## Purpose
A dermatology photo organization system that runs locally to help medical professionals organize patient photos by body parts and track progression of skin conditions (moles, lesions) over time. The application works entirely offline and integrates with camera hardware for direct photo capture.

## Tech Stack
- **Frontend**: React 19.1.1 with TypeScript 5.8+
- **Build Tool**: Vite 7.1.7 with ES2022 target
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS 3.4.17 with CSS-in-JS approach
- **Database**: IndexedDB via Dexie 4.2.0 for local storage
- **Form Handling**: React Hook Form 7.63.0 with Zod 4.1.11 validation
- **PDF Export**: jsPDF 3.0.3 for report generation
- **PWA**: Vite PWA plugin for offline functionality
- **Testing**: Vitest 3.2.4 with Testing Library
- **Icons**: Lucide React 0.544.0

## Project Conventions

### Code Style
- **TypeScript**: Strict mode enabled, explicit function return types encouraged
- **Formatting**: Prettier with single quotes, semicolons, 100-character line width
- **ESLint**: TypeScript ESLint with Prettier integration, no unused vars
- **File Naming**: kebab-case for files, PascalCase for components
- **Imports**: Absolute imports using '@/' alias for src directory
- **Components**: Functional components with hooks, TypeScript interfaces for props

### Architecture Patterns
- **Component Architecture**: Modular React components with separation of concerns
- **State Management**: Local component state with React hooks, no global state management
- **Data Layer**: Service layer pattern with TypeScript services for different domains
- **Database**: Object-oriented design with Dexie ORM for IndexedDB
- **File System**: Browser File System Access API for local file operations
- **Error Handling**: Centralized error handling with user-friendly messages

### Testing Strategy
- **Unit Tests**: Vitest for component and service unit testing
- **Integration Tests**: Testing Library for user interaction testing
- **Contract Tests**: Service contract tests to ensure API compatibility
- **Mock Strategy**: Fake IndexedDB and JSDOM for test environment
- **Coverage**: Focus on critical paths and business logic
- **Test Files**: Co-located with source files in dedicated tests directories

### Git Workflow
- **Feature Branches**: Use descriptive branch names like `001-build-an-application`
- **Commits**: Conventional commit format with clear, atomic changes
- **Code Review**: PR-based workflow with automated checks
- **Deployment**: Netlify deployment from main branch
- **Version Control**: Git with semantic versioning approach

## Domain Context

### Medical Domain
- **Patient Management**: Each patient has unique identifier, name, date of birth, assigned doctor
- **Body Part Classification**: Hierarchical anatomical structure (e.g., arm → upper arm/forearm)
- **Progress Tracking**: Temporal photo sequences showing skin condition changes
- **Medical Workflow**: Patient visits, photo capture, progress review, follow-up scheduling
- **Urgency Management**: Flagging urgent cases and scheduling follow-up appointments

### Data Organization
- **Album Structure**: Patient albums containing nested body part categories
- **Photo Metadata**: Capture date, body part location, patient relationship, urgency status
- **Progress Views**: Tile-based chronological display of photos from same location
- **Export Requirements**: PDF reports with patient information and photo collections

## Important Constraints
- **Offline Operation**: Application must work entirely without internet connectivity
- **Local Storage**: All data stored locally on device, no external network communication
- **Medical Privacy**: Patient data stored locally, no cloud synchronization
- **Camera Integration**: Direct camera hardware integration for photo capture
- **Cross-Platform**: Web-based application running on modern browsers
- **Performance**: Efficient handling of large photo collections
- **Data Persistence**: Reliable local storage with IndexedDB

## External Dependencies
- **Browser APIs**: File System Access API, MediaDevices API for camera access
- **Font Loading**: Google Fonts cached via PWA service worker
- **Build Environment**: Node.js 20+ for development and build processes
- **Deployment**: Netlify for static site hosting with proper security headers
- **Hardware**: Camera device integration through browser media APIs

## Development Commands
```bash
# Development
npm run dev              # Start development server
npm run build           # Build for production
npm run preview         # Preview production build

# Testing
npm test                # Run tests in watch mode
npm run test:run        # Run tests once
npm run test:ui         # Run tests with UI

# Code Quality
npm run lint            # Run ESLint
npm run lint:fix        # Auto-fix ESLint issues
```

## Security Considerations
- **Local Storage Only**: No external API calls or data transmission
- **File Access**: Restricted to user-selected directories via File System Access API
- **Camera Permissions**: Explicit user permission required for camera access
- **Content Security**: PWA security headers configured for offline operation
- **Data Privacy**: Patient data never leaves the local device
