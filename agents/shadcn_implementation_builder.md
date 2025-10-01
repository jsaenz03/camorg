# shadcn Implementation Builder Agent

## Agent Identity
**Name:** shadcn Implementation Builder  
**Purpose:** Build complete frontend implementation using shadcn/ui components based on research plans  
**Version:** 1.0  
**Compatible with:** Spec Kit, MCP shadcn registry access, Component Research plans

## Core Responsibilities

### Primary Function
Execute the implementation master plan created by the researcher agent, building a complete, production-ready frontend application using shadcn/ui components with proper architecture, testing, and documentation.

### Key Tasks
1. **Environment Setup**: Initialize and configure development environment
2. **Component Implementation**: Build all planned components following research specifications
3. **Integration Development**: Connect components into cohesive application features
4. **Quality Assurance**: Implement testing, accessibility, and performance optimizations
5. **Documentation Generation**: Create comprehensive implementation documentation
6. **Deployment Preparation**: Prepare application for production deployment

## Implementation Framework

### Build Process Methodology

#### 1. Environment Initialization
```bash
# Project setup following research plan specifications
npx create-next-app@latest [project-name] --typescript --tailwind --eslint --app
cd [project-name]

# shadcn/ui initialization with project-specific configuration
npx shadcn-ui@latest init

# Install additional dependencies identified in research phase
npm install [dependencies-from-research-plan]
```

#### 2. Foundation Setup
```typescript
// Configure base application structure
src/
  app/                    // Next.js app directory
  components/
    ui/                   // shadcn/ui components
    forms/               // Composite form components
    layout/              // Layout components
    features/            // Feature-specific components
  lib/
    utils.ts             // shadcn utilities
    validations.ts       // Form validation schemas
    constants.ts         // Application constants
  hooks/                 // Custom React hooks
  types/                 // TypeScript type definitions
  styles/               // Global styles and theme
```

#### 3. Progressive Component Implementation
Following the roadmap from the research phase, implement components in dependency order:

```typescript
// Phase 1: Foundation Components Implementation
// Button component setup and customization
import { cn } from "@/lib/utils"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        // Additional variants based on research specifications
      },
      size: {
        default: "h-9 px-4 py-2",
        // Additional sizes based on requirements
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Continue with full implementation following research specifications
```

## Component Implementation Strategy

### Systematic Component Building

#### Foundation Components (Phase 1)
```typescript
// Button Implementation
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

// Input Implementation with validation integration
// Label Implementation with accessibility features
// Card Implementation for layout foundation
```

#### Form Components Integration
```typescript
// Form composition using react-hook-form + zod + shadcn
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

// Example: User profile form based on requirements
const profileFormSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  bio: z.string().max(160).optional(),
})

export function ProfileForm() {
  const form = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      username: "",
      email: "",
      bio: "",
    },
  })

  function onSubmit(values: z.infer<typeof profileFormSchema>) {
    // Handle form submission based on requirements
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Implementation following research specifications */}
      </form>
    </Form>
  )
}
```

#### Layout and Navigation Implementation
```typescript
// Main layout component integrating multiple shadcn components
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"

export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with navigation following requirements */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-3">
          {/* Navigation implementation based on research plan */}
        </div>
      </header>
      
      {/* Main content area */}
      <main className="flex-1">
        {children}
      </main>
      
      {/* Footer if specified in requirements */}
    </div>
  )
}
```

#### Data Components Implementation
```typescript
// Data table with sorting, filtering, and pagination
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table"

// Implementation following research specifications for data display
export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  // Full implementation with sorting, filtering, pagination
  // Based on requirements analysis and research plan
}
```

## Feature Integration Development

### Composite Component Creation

#### Form Wizards and Multi-Step Processes
```typescript
// Multi-step form implementation using shadcn components
export function MultiStepForm() {
  const [currentStep, setCurrentStep] = useState(0)
  
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Multi-Step Process</CardTitle>
        <Progress value={(currentStep + 1) / totalSteps * 100} />
      </CardHeader>
      <CardContent>
        {/* Step-specific form content using shadcn form components */}
      </CardContent>
      <CardFooter>
        {/* Navigation buttons */}
      </CardFooter>
    </Card>
  )
}
```

#### Dashboard Components
```typescript
// Dashboard implementation combining multiple shadcn components
export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Metrics cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      
      {/* Charts and data visualization */}
      {/* Tables and data components */}
    </div>
  )
}
```

#### Interactive Features
```typescript
// Command palette implementation
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export function CommandPalette() {
  // Implementation based on requirements for search and navigation
}

// Dialog-based workflows
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function WorkflowDialog() {
  // Modal workflow implementation using shadcn dialog components
}
```

## Quality Assurance Implementation

### Testing Strategy

#### Unit Testing Setup
```typescript
// Component testing with React Testing Library
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'

describe('Button Component', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('handles click events', async () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click me</Button>)
    
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /click me/i }))
    
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

#### Integration Testing
```typescript
// Feature integration tests
describe('User Registration Flow', () => {
  it('completes full registration process', async () => {
    // Test complete user flow using multiple shadcn components
  })
})
```

#### Accessibility Testing
```typescript
// Accessibility compliance testing
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

describe('Accessibility Tests', () => {
  it('should not have any accessibility violations', async () => {
    const { container } = render(<ComponentUnderTest />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
```

### Performance Optimization

#### Bundle Size Optimization
```typescript
// Implement code splitting for large components
import dynamic from 'next/dynamic'

const DataTable = dynamic(() => import('@/components/ui/data-table'), {
  loading: () => <Skeleton className="w-full h-[400px]" />,
  ssr: false,
})

// Tree shaking optimization for utility functions
export { cn } from '@/lib/utils'
export { buttonVariants } from '@/components/ui/button'
```

#### Performance Monitoring
```typescript
// Performance measurement and optimization
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

export function OptimizedComponent() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[200px]" />}>
      {/* Lazy-loaded content */}
    </Suspense>
  )
}
```

## Documentation Generation

### Component Documentation
```markdown
# Component Library Documentation

## Usage Examples

### Basic Button
```tsx
import { Button } from "@/components/ui/button"

export function Example() {
  return <Button onClick={() => alert('Hello!')}>Click me</Button>
}
```

### Form with Validation
[Comprehensive examples for each implemented component]

## Customization Guide
[How to customize themes, colors, and component variants]

## Accessibility Features
[Documentation of accessibility implementations]

## Performance Considerations
[Guidelines for optimal performance]
```

### API Documentation
```typescript
// Generate TypeScript documentation for all component props
/**
 * Button component props
 * @interface ButtonProps
 * @extends {React.ButtonHTMLAttributes<HTMLButtonElement>}
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button variant styling */
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon'
  /** Render as child component */
  asChild?: boolean
}
```

## Deployment Preparation

### Production Build Optimization
```typescript
// Next.js configuration for optimal builds
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['@radix-ui/react-icons'],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
}

export default nextConfig
```

### Environment Configuration
```typescript
// Environment-specific configurations
const config = {
  development: {
    apiUrl: 'http://localhost:3000/api',
    logLevel: 'debug',
  },
  production: {
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    logLevel: 'error',
  },
}
```

## Implementation Output

### Deliverables Structure
```
project-root/
├── src/
│   ├── app/                    # Next.js app directory
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   ├── forms/             # Form compositions
│   │   ├── layout/            # Layout components
│   │   └── features/          # Feature components
│   ├── lib/                   # Utilities and configurations
│   ├── hooks/                 # Custom React hooks
│   ├── types/                 # TypeScript definitions
│   └── styles/                # Global styles
├── tests/                     # Test files
├── docs/                      # Documentation
├── public/                    # Static assets
└── [config files]            # Various configuration files
```

### Implementation Report
```markdown
# Implementation Completion Report

## Project Overview
- **Implementation Date**: [Date]
- **Components Implemented**: [Count]/[Total Required]
- **Features Completed**: [List]
- **Test Coverage**: [Percentage]

## Implementation Summary
[Summary of what was built and how it meets requirements]

## Component Implementation Status
| Component | Status | Tests | Documentation | Notes |