<!--
Sync Impact Report:
- Version change: 1.0.0 (initial ratification)
- New constitution created for Next.js + shadcn project
- Principles established:
  1. Component-First Architecture
  2. Type Safety & Validation
  3. Accessibility First (NON-NEGOTIABLE)
  4. Performance & Core Web Vitals
  5. Developer Experience
- Templates alignment: ✅ All templates verified for compatibility
- Follow-up TODOs: None - all placeholders filled
-->

# Camog Application Constitution

## Core Principles

### I. Component-First Architecture
All UI features MUST be built using reusable, composable components. Components MUST:
- Be built with shadcn/ui primitives when available
- Follow the single responsibility principle
- Accept props for customization rather than hard-coded values
- Be colocated with their tests and stories when applicable

**Rationale**: Component reusability reduces code duplication, improves maintainability, and ensures consistent UI patterns across the application.

### II. Type Safety & Validation
TypeScript MUST be used for all code with strict mode enabled. Type safety requirements:
- No `any` types unless explicitly justified in code comments
- Props interfaces MUST be defined for all components
- API responses MUST have typed schemas
- Form inputs MUST use Zod or similar for runtime validation
- Server actions MUST validate input before processing

**Rationale**: Type safety catches errors at compile time, improves IDE support, and serves as living documentation for the codebase.

### III. Accessibility First (NON-NEGOTIABLE)
All UI components MUST meet WCAG 2.1 AA standards. Required practices:
- Semantic HTML elements over divs
- ARIA labels for interactive elements
- Keyboard navigation support for all interactive features
- Color contrast ratios of at least 4.5:1 for text
- Focus indicators visible on all focusable elements
- Screen reader testing for critical user journeys

**Rationale**: Accessibility is a fundamental right, not a feature. It ensures the application is usable by everyone and often improves overall UX.

### IV. Performance & Core Web Vitals
Application MUST maintain excellent Core Web Vitals scores. Performance requirements:
- Largest Contentful Paint (LCP) < 2.5s
- First Input Delay (FID) < 100ms
- Cumulative Layout Shift (CLS) < 0.1
- Use Next.js Image component for all images
- Implement code splitting and lazy loading for routes
- Server Components by default, Client Components only when necessary
- Optimize bundle size (monitor with `next build`)

**Rationale**: Performance directly impacts user experience, SEO rankings, and conversion rates.

### V. Developer Experience
Code MUST be easy to understand, maintain, and extend. DX requirements:
- Consistent code formatting via Prettier
- ESLint rules enforced in CI
- Clear naming conventions (camelCase for functions, PascalCase for components)
- Documentation for complex logic
- Hot module reload MUST work reliably
- Clear error messages with actionable guidance

**Rationale**: Good developer experience reduces onboarding time, minimizes bugs, and increases team velocity.

## UI/UX Standards

### Design System Adherence
- All components MUST use Tailwind CSS v4 for styling
- shadcn/ui components MUST be the first choice for common UI patterns
- Custom components MUST match shadcn design tokens (colors, spacing, typography)
- Responsive design MUST support mobile, tablet, and desktop (mobile-first approach)
- Dark mode support REQUIRED for all components

### User Experience Requirements
- Loading states MUST be shown for async operations (use Suspense boundaries)
- Error states MUST provide clear, actionable messages
- Forms MUST provide inline validation feedback
- Success actions MUST have visual confirmation (toasts, success states)
- Navigation MUST be intuitive with clear hierarchy

## Code Quality Standards

### Testing Strategy
Testing is OPTIONAL unless specified in feature requirements. When tests are requested:
- Unit tests for utility functions and hooks
- Component tests for complex interactive components
- Integration tests for critical user journeys
- Visual regression tests for design system components

### Code Organization
- Use Next.js App Router file structure (`app/` directory)
- Group related components in feature folders
- Shared components in `components/` directory
- Utilities in `lib/` directory
- Types in `types/` directory or colocated with usage
- Server actions in `actions/` or colocated with routes

### Version Control
- Meaningful commit messages following conventional commits format
- Feature branches from main
- Pull requests require review before merge (when team > 1)
- No direct commits to main branch

## Governance

### Amendment Process
This constitution represents the foundational principles for the Camog application. Amendments MUST:
1. Be proposed with clear rationale and impact analysis
2. Be documented via constitution update with version bump
3. Include migration plan if existing code is affected
4. Update all dependent templates and documentation

### Compliance & Review
- All pull requests MUST verify compliance with these principles
- Complexity or deviations MUST be explicitly justified in plan.md
- Regular architecture reviews to ensure alignment with constitution
- Update this constitution as project evolves and new patterns emerge

### Living Documentation
- This constitution should evolve with the project
- Document new patterns and anti-patterns as they emerge
- Keep principles focused and actionable
- Prefer specific guidance over vague aspirations

**Version**: 1.0.0 | **Ratified**: 2025-10-08 | **Last Amended**: 2025-10-08
