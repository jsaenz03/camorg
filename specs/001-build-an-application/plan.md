
# Implementation Plan: Dermatology Photo Organization System

**Branch**: `001-build-an-application` | **Date**: 2025-09-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/jsaenz/camorgv1/specs/001-build-an-application/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
A desktop application for dermatology clinics to organize patient photos by body parts and track progression of moles/lesions over time. The system operates entirely offline, integrates with camera hardware for direct photo capture, and provides a hierarchical organization structure by patient and anatomical location. Built with Vite, vanilla HTML/CSS/JavaScript, and local database storage.

## Technical Context
**Language/Version**: JavaScript ES2022, HTML5, CSS3 with TypeScript 5.0+ for type safety
**Primary Dependencies**: Vite (build tool), shadcn/ui components, minimal additional libraries
**Storage**: Local IndexedDB for photo metadata, File System Access API for photo storage
**Testing**: Vitest for unit tests, Playwright for E2E testing
**Target Platform**: Desktop web application (Electron wrapper optional for native distribution)
**Project Type**: single - desktop web application with local file system integration
**Performance Goals**: <100ms UI interactions, <2s photo loading, 60fps smooth navigation
**Constraints**: Completely offline-capable, no external network dependencies, HIPAA-conscious local storage
**Scale/Scope**: Single clinic usage, ~100-500 patients, ~10k photos per clinic, 5-10 concurrent users

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Code Quality Gates
- [x] TypeScript strict mode enabled with zero warnings
- [x] ESLint/Prettier configuration confirmed
- [x] Complexity thresholds defined (cyclomatic <10, cognitive <15, file <300 lines)
- [x] Component architecture follows single responsibility principle

### Testing Requirements
- [x] TDD approach confirmed: tests written before implementation
- [x] Unit test coverage target >95% established
- [x] Integration tests planned for user interactions
- [x] Visual regression testing strategy defined (Playwright)

### UX Consistency Gates
- [x] Design system tokens usage confirmed (shadcn/ui compliance)
- [x] WCAG 2.1 AA accessibility requirements planned
- [x] Responsive design approach defined (mobile-first)
- [x] Component states planned (loading, error, empty, interactive)

### Performance Standards
- [x] Bundle size budget established (<50KB per component gzipped)
- [x] Performance targets defined (paint <100ms, interaction <16ms)
- [x] Tree-shaking compatibility confirmed
- [x] Lazy loading strategy for non-critical components

### Documentation Requirements
- [x] Storybook integration planned
- [x] TypeScript interfaces for prop documentation
- [x] Usage guidelines and examples planned
- [x] Accessibility documentation included

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
src/
├── components/           # shadcn/ui components and custom components
│   ├── ui/              # shadcn/ui base components
│   ├── patient/         # Patient management components
│   ├── photo/           # Photo capture and display components
│   └── navigation/      # Navigation and layout components
├── pages/               # Application pages/views
│   ├── patients/        # Patient list and detail pages
│   ├── photos/          # Photo viewing and organization pages
│   └── settings/        # Application settings
├── services/            # Business logic and data access
│   ├── database/        # IndexedDB operations
│   ├── camera/          # Camera integration
│   └── export/          # PDF export functionality
├── models/              # TypeScript interfaces and data models
├── utils/               # Utility functions and helpers
└── styles/              # Global styles and theme tokens

tests/
├── unit/                # Unit tests for services and utilities
├── component/           # Component testing with React Testing Library
├── integration/         # Integration tests for user workflows
└── e2e/                 # End-to-end tests with Playwright

public/
├── index.html
└── manifest.json        # PWA manifest for offline capabilities
```

**Structure Decision**: Single web application structure chosen as the system is a desktop web app that operates entirely offline with local storage. This structure separates concerns clearly while maintaining simplicity for the minimal dependency requirement.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract service interface → TypeScript interface definition task [P]
- Each contract service interface → service implementation task
- Each contract method → unit test task [P]
- Each entity from data model → TypeScript interface task [P]
- Each entity from data model → validation schema task [P]
- Each quickstart scenario → integration test task
- UI components for each service → component implementation task
- Each functional requirement → feature implementation task

**Ordering Strategy**:
- TDD order: Interface definitions → Tests → Implementation
- Dependency order: Models → Services → Components → Pages → Integration
- Infrastructure first: Database setup, file system access, camera integration
- Core services before UI: Patient/Photo/BodyPart services before components
- Mark [P] for parallel execution (independent files within same layer)

**Task Categories**:
1. **Foundation** (5-7 tasks): Project setup, TypeScript config, IndexedDB setup
2. **Models & Validation** (8-10 tasks): Entity interfaces, Zod schemas, type guards
3. **Service Interfaces** (4 tasks): Contract implementations for core services
4. **Service Tests** (12-15 tasks): Unit tests for all service methods
5. **Service Implementation** (12-15 tasks): Actual service logic and database operations
6. **UI Components** (15-20 tasks): shadcn/ui integration, custom components
7. **Pages & Navigation** (8-10 tasks): Application pages and routing
8. **Integration Tests** (6-8 tasks): End-to-end quickstart scenarios
9. **Performance & Polish** (3-5 tasks): Optimization, PWA setup, offline functionality

**Estimated Output**: 35-45 numbered, ordered tasks in tasks.md

**Implementation Notes**:
- Vite project setup with TypeScript strict mode
- shadcn/ui CLI integration for component scaffolding
- Dexie.js for IndexedDB operations with typed schemas
- File System Access API integration with fallback patterns
- Camera API integration with permission handling
- Vitest configuration for unit testing
- Playwright configuration for E2E testing
- PWA manifest and service worker setup

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.0.0 - See `.specify/memory/constitution.md`*
