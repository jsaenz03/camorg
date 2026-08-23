# Camog macOS User Guide

Simple guide for using Camog on macOS, including installation, file locations, editing, and maintenance.

## Installation

### Prerequisites
1. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
2. **Rust toolchain** - Install via terminal:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Xcode Command Line Tools** - Run in terminal:
   ```bash
   xcode-select --install
   ```

### Install Camog
1. Open terminal and navigate to the camog directory
2. Install dependencies:
   ```bash
   cd /Users/jsaenz-macbook/apps/camog
   npm install
   ```

### Running the App
```bash
npm run desktop
```

This opens the Camog desktop application window.

## Default Login

On first launch, Camog creates a default admin account automatically:

- **Username:** `admin`
- **Passcode:** `devpass123`
- **Display Name:** Administrator

> **Important:** Change these credentials after first login for security.

## File Locations

### Application Files
- **Project Directory:** `/Users/jsaenz-macbook/apps/camog/`
- **Source Code:** `app/`, `components/`, `lib/`
- **Configuration:** `.env`, `src-tauri/tauri.conf.json`

### Data Files
Camog stores all data in your Application Support folder:

**Main Directory:** `~/Library/Application Support/com.camog.app/`

Inside this directory you'll find:
- `camog.db` - SQLite database (patients, photos metadata, clinicians)
- `photos/<photoId>.jpg` - Full-size JPEG photos (compressed to ≤1920px)
- `photos/<photoId>.thumb.jpg` - 200×200 thumbnail images

### Build Output
When building installers, output goes to:
- `src-tauri/target/release/bundle/` - macOS .dmg and .app files
- `installers/` - Additional installer directories

## Editing Configuration

### Environment Variables
Edit the `.env` file in the project root:

```bash
nano /Users/jsaenz-macbook/apps/camog/.env
```

**Available settings:**
```bash
NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_USERNAME=admin
NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_PASSCODE=devpass123
NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_DISPLAY_NAME=Administrator
NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_MUST_CHANGE=false
```

### Changing Default Credentials
1. Edit the `.env` file with new credentials
2. Delete existing database: `rm ~/Library/Application Support/com.camog.app/camog.db`
3. Restart app - new admin account will be created with updated credentials

### App Configuration
Edit `src-tauri/tauri.conf.json` to change:
- Window size and title
- App icon
- Security settings
- Build targets

## Maintenance

### Reset Database
To completely reset Camog (delete all data):

```bash
rm -rf ~/Library/Application Support/com.camog.app/
```

### Backup Data
Backup the entire application data directory:

```bash
cp -r ~/Library/Application Support/com.camog.app/ ~/camog-backup/
```

### Update Application
```bash
cd /Users/jsaenz-macbook/apps/camog
git pull origin main
npm install
npm run desktop
```

### Build Installer
```bash
npm run desktop:build
```

Creates macOS installer in `src-tauri/target/release/bundle/`

## Troubleshooting

### Cannot Login
1. Check `.env` file has correct bootstrap credentials
2. Reset database and restart app to recreate admin account
3. Verify database file exists at `~/Library/Application Support/com.camog.app/camog.db`

### Camera Not Working
- Ensure camera permissions are granted to Camog in System Preferences
- Check Camera is not in use by another application

### App Won't Start
1. Check Node.js and Rust are properly installed
2. Verify all dependencies: `npm install`
3. Check terminal for error messages when running `npm run desktop`

### Database Issues
- Location: `~/Library/Application Support/com.camog.app/camog.db`
- If corrupted, delete the entire `com.camog.app` directory and restart

## Development vs Production

### Development Mode (`npm run desktop`)
- Hot reload enabled
- More verbose error messages
- Database in dev location

### Production Build
- Optimized performance
- Error messages simplified
- Database in production location
- Run via installed .app or .dmg

## Security Notes

- Passcodes stored as PBKDF2 hash (210k iterations, per-user salt)
- No plaintext passwords stored
- Local SQLite database only (no cloud transmission)
- Change default admin credentials after installation

## Support

For issues or questions:
1. Check this guide first
2. Review error messages in terminal when running `npm run desktop`
3. Check database and file permissions
4. Verify environment configuration in `.env` file
