# cIQCam

A Progressive Web App (PWA) for medical professionals to organize and track patient medical photos, categorized by body parts, with offline-first capabilities.

## Features

- **Patient Management**: Create, edit, and manage patient records with comprehensive medical information
- **Photo Organization**: Capture or import photos directly from camera, organized by anatomical body parts
- **Progress Tracking**: Track skin condition changes over multiple sessions/visits
- **Offline-First**: All data stored locally using IndexedDB - works completely offline
- **PDF Reports**: Generate comprehensive patient reports with photos and metadata
- **Hierarchical Body Parts**: Organize photos by anatomical regions with nested categories
- **Privacy-Focused**: All data stays on the device - no cloud sync

## Tech Stack

- **Frontend**: React 19.1.1 + TypeScript 5.8.3
- **Build Tool**: Vite 7.1.7
- **UI Components**: shadcn/ui + Radix UI + Tailwind CSS
- **Database**: IndexedDB via Dexie 4.2.0
- **Forms**: React Hook Form + Zod validation
- **PDF Export**: jsPDF
- **PWA**: Vite PWA Plugin with offline support
- **Testing**: Vitest + React Testing Library

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd camorg
   ```

2. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser to `http://localhost:5173`

### Available Scripts

From the `/frontend` directory:

- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - Build for production (TypeScript compile + Vite build)
- `npm run preview` - Preview production build locally
- `npm test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run test:ui` - Run tests with UI interface
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Auto-fix ESLint issues

## Project Structure

```
camorg/
├── frontend/                    # React application
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── ui/            # shadcn/ui base components
│   │   │   ├── photo/         # Photo capture and management
│   │   │   └── patient/       # Patient management
│   │   ├── pages/             # Main application pages
│   │   ├── services/          # Business logic layer
│   │   ├── models/            # Data models and validators
│   │   ├── database/          # IndexedDB schema
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Utilities
│   │   └── tests/             # Unit and integration tests
│   ├── public/                # Static assets
│   └── package.json
├── openspec/                  # Project specifications
├── specs/                     # Feature specifications
└── CLAUDE.md                  # Development guidelines
```

## Usage

### First Launch

On first launch, you'll be prompted to complete the Camera Setup Wizard to grant camera permissions (required for photo capture).

### Managing Patients

1. Click "Patients" in the navigation
2. Click "Add Patient" to create a new patient record
3. Fill in patient details (name, DOB, medical history, etc.)
4. Click a patient to view their detail page

### Capturing Photos

1. Navigate to a patient's detail page
2. Click "Add Photo" or select a body part category
3. Choose to capture from camera or import an existing file
4. Photos are automatically organized by body part

### Organizing by Body Parts

- Photos can be organized in a hierarchical structure (e.g., Torso → Chest → Left Breast)
- Create custom body part categories as needed
- View photos filtered by specific anatomical regions

### Generating Reports

1. Navigate to a patient's detail page
2. Click "Export Report"
3. Select photos and sessions to include
4. Generate PDF report with patient information and photos

## Database Schema

The app uses IndexedDB with the following tables:

- **patients** - Patient demographics and medical history
- **bodyPartCategories** - Hierarchical anatomical regions
- **photos** - Photo metadata and file references
- **progressSessions** - Visit/session tracking
- **exportReports** - PDF generation history

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires support for:
- IndexedDB
- MediaDevices.getUserMedia (for camera)
- File System Access API (optional, for file import)

## Development

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier for code formatting
- Conventional Commits for git messages

### Testing

Tests are written with Vitest and React Testing Library. Note that some tests requiring browser APIs (camera, file system) may fail in Node.js environment but work correctly in browsers.

### Building for Production

```bash
cd frontend
npm run build
```

Output will be in `frontend/dist/` directory.

## Deployment

The app is configured for Netlify deployment (see `netlify.toml`). The PWA service worker enables offline functionality after the first load.

## Privacy & Security

- All data is stored locally on the device using IndexedDB
- No data is transmitted to external servers
- No cloud sync or backup (by design)
- Suitable for HIPAA-compliant workflows when deployed properly

## Contributing

See `openspec/AGENTS.md` for information on the OpenSpec workflow used for managing changes to this project.

## License

[Add your license here]

## Support

For issues or questions, please refer to the documentation in the `openspec/` directory.
