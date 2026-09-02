// Self-check: the phone-camera tether must be wired end to end — Rust server
// command registered, phone page POSTs to the tokened path and drives the
// native camera, and the frontend panel listens for the matching events and
// is reachable from the capture screen. Also covers drag-drop upload wiring
// and the app logo assets, since they share the capture/save pipeline.
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const cargo = read('../src-tauri/Cargo.toml');
for (const dep of ['tiny_http', 'base64', 'rand']) {
  assert(cargo.includes(`${dep} =`), `Cargo.toml missing dep: ${dep}`);
}

const lib = read('../src-tauri/src/lib.rs');
assert(lib.includes('mod remote_camera'), 'lib.rs missing remote_camera module');
for (const cmd of [
  'start_remote_camera',
  'stop_remote_camera',
  'get_phone_link_remember',
  'set_phone_link_remember',
]) {
  assert(lib.includes(cmd), `lib.rs does not register command: ${cmd}`);
}

const rust = read('../src-tauri/src/remote_camera.rs');
// Event names must match what the frontend listens for.
for (const needle of ['remote-camera-photo', 'remote-camera-status']) {
  assert(rust.includes(needle), `remote_camera.rs missing event: ${needle}`);
}
// Remembered pairing: the token persists in the app data dir so the phone's
// saved link keeps working across app restarts, and the "start automatically"
// preference is stored beside it (default on).
for (const needle of ['phone-link-token', 'phone-link.json', 'pairing_token']) {
  assert(rust.includes(needle), `remote_camera.rs missing remembered-pairing piece: ${needle}`);
}
// Home-screen app: the manifest (with the logo icon) is served by the shell.
assert(rust.includes('manifest.webmanifest'), 'remote_camera.rs missing PWA manifest route');
assert(rust.includes('WEB_MANIFEST'), 'remote_camera.rs missing WEB_MANIFEST');
// The phone page must use the native camera (getUserMedia is blocked on
// plain LAN http) and re-encode to JPEG like the desktop path.
const phonePage = read('../src-tauri/src/remote_camera_page.rs');
for (const needle of ['capture="environment"', 'image/jpeg']) {
  assert(phonePage.includes(needle), `remote_camera_page.rs phone page missing: ${needle}`);
}
// The phone page links the manifest and the home-screen icon.
for (const needle of ['rel="manifest"', 'rel="apple-touch-icon"']) {
  assert(phonePage.includes(needle), `phone page missing PWA link: ${needle}`);
}
assert(rust.includes('/t/'), 'remote_camera.rs missing tokened path /t/');

const panel = read('../components/camera/phone-camera-panel.tsx');
for (const needle of ['QRCodeSVG', 'useCompanion']) {
  assert(panel.includes(needle), `phone-camera-panel.tsx missing: ${needle}`);
}

// The capture dialog owns the photo event while it is open (fast path into
// the form, or the pending tray when a photo is mid-review)…
const captureDialog = read('../components/capture/capture-dialog.tsx');
for (const needle of ['remote-camera-photo', 'storePendingPhoto', 'setCaptureScreenActive']) {
  assert(captureDialog.includes(needle), `capture dialog missing: ${needle}`);
}
// …and the companion provider stages photos when the page is not mounted.
const provider = read('../components/companion/companion-provider.tsx');
for (const needle of ['remote-camera-photo', 'storePendingPhoto']) {
  assert(provider.includes(needle), `companion-provider.tsx missing: ${needle}`);
}
// Remembered link: the provider reads the preference and auto-starts the
// link on launch, and the dialog carries the toggle.
for (const needle of ['get_phone_link_remember', 'set_phone_link_remember']) {
  assert(provider.includes(needle), `companion-provider.tsx missing: ${needle}`);
}
const linkDialog = read('../components/companion/phone-link-dialog.tsx');
for (const needle of ['remember-link', 'setRemember']) {
  assert(linkDialog.includes(needle), `phone-link-dialog.tsx missing remember toggle: ${needle}`);
}

const capture = read('../components/camera/camera-capture.tsx');
assert(
  capture.includes('PhoneCameraPanel'),
  'camera-capture.tsx does not mount PhoneCameraPanel'
);
assert(
  capture.includes('useState(true)'),
  'camera-capture.tsx phone mode is not the default landing (useState(true))'
);
assert(
  capture.includes('handleUsePhoneCamera'),
  'camera-capture.tsx has no way to enter phone mode'
);

// Camera picker: phones tethered as USB webcams (Continuity/Camo/Iriun) are
// selected here rather than through a custom tether protocol.
const service = read('../lib/services/camera-service.ts');
assert(service.includes('listCameras'), 'camera-service.tsx missing listCameras');
for (const needle of ['camog:camera-device-id', 'SelectItem', 'devicechange', 'deviceId']) {
  assert(capture.includes(needle), `camera picker missing in camera-capture.tsx: ${needle}`);
}

// Dev-server port: tauri devUrl and the Next dev port must agree and stay
// off 3000, where another local Next app hijacked the Tauri window.
const tauriConf = JSON.parse(read('../src-tauri/tauri.conf.json'));
const pkg = JSON.parse(read('../package.json'));
assert(
  tauriConf.build.devUrl === 'http://localhost:3434',
  `devUrl is ${tauriConf.build.devUrl}, expected http://localhost:3434`
);
assert(pkg.scripts.dev.includes('-p 3434'), 'dev script not pinned to port 3434');
assert(
  (tauriConf.app.security.devCsp ?? '').includes('localhost:3434'),
  'devCsp does not allow port 3434 for HMR'
);

// Drag-and-drop upload: patient view must mount the uploader, which saves
// through the same createPhoto path as captured photos.
const upload = read('../components/photo/photo-upload.tsx');
for (const needle of ['createPhoto', 'dragover', "addEventListener('drop'", 'PhotoMetadataForm', 'image/heic']) {
  assert(upload.includes(needle), `photo-upload.tsx missing: ${needle}`);
}
const viewPage = read('../app/(dashboard)/patients/view/page.tsx');
assert(viewPage.includes('PhotoUpload'), 'patients/view page does not mount PhotoUpload');

// Brand assets: sidebar mark, and installer icons regenerated for the logo.
assert(existsSync(new URL('../public/logo.png', import.meta.url)), 'public/logo.png missing');
const sidebar = read('../components/app-sidebar.tsx');
assert(sidebar.includes('/logo.png'), 'app-sidebar does not use /logo.png brand mark');
assert(
  existsSync(new URL('../src-tauri/icons/icon.icns', import.meta.url)),
  'macOS installer icon (icon.icns) missing'
);
assert(
  existsSync(new URL('../src-tauri/icons/icon.ico', import.meta.url)),
  'Windows installer icon (icon.ico) missing'
);

console.log('phone-tether self-check passed');
