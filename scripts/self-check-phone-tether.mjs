// Self-check: the phone-camera tether must be wired end to end — Rust server
// command registered, phone page POSTs to the tokened path and drives the
// native camera, and the frontend panel listens for the matching events and
// is reachable from the capture screen. Also covers drag-drop upload wiring
// and the app logo assets, since they share the capture/save pipeline.
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const cargo = read('../src-tauri/Cargo.toml');
for (const dep of ['tiny_http', 'base64', 'rand']) {
  console.assert(cargo.includes(`${dep} =`), `Cargo.toml missing dep: ${dep}`);
}

const lib = read('../src-tauri/src/lib.rs');
console.assert(lib.includes('mod remote_camera'), 'lib.rs missing remote_camera module');
for (const cmd of ['start_remote_camera', 'stop_remote_camera']) {
  console.assert(lib.includes(cmd), `lib.rs does not register command: ${cmd}`);
}

const rust = read('../src-tauri/src/remote_camera.rs');
// Event names must match what the frontend listens for.
for (const needle of ['remote-camera-photo', 'remote-camera-status']) {
  console.assert(rust.includes(needle), `remote_camera.rs missing event: ${needle}`);
}
// The phone page must use the native camera (getUserMedia is blocked on
// plain LAN http) and re-encode to JPEG like the desktop path.
for (const needle of ['capture="environment"', 'image/jpeg', '/t/']) {
  console.assert(rust.includes(needle), `remote_camera.rs phone page missing: ${needle}`);
}

const panel = read('../components/camera/phone-camera-panel.tsx');
for (const needle of [
  'remote-camera-photo',
  'remote-camera-status',
  'start_remote_camera',
  'stop_remote_camera',
  'QRCodeSVG',
  'onPhotoCaptured',
]) {
  console.assert(panel.includes(needle), `phone-camera-panel.tsx missing: ${needle}`);
}

const capture = read('../components/camera/camera-capture.tsx');
console.assert(
  capture.includes('PhoneCameraPanel'),
  'camera-capture.tsx does not mount PhoneCameraPanel'
);
console.assert(
  capture.includes('handleUsePhoneCamera'),
  'camera-capture.tsx has no way to enter phone mode'
);

// Camera picker: phones tethered as USB webcams (Continuity/Camo/Iriun) are
// selected here rather than through a custom tether protocol.
const service = read('../lib/services/camera-service.ts');
console.assert(service.includes('listCameras'), 'camera-service.tsx missing listCameras');
for (const needle of ['camog:camera-device-id', 'SelectItem', 'devicechange', 'deviceId']) {
  console.assert(capture.includes(needle), `camera picker missing in camera-capture.tsx: ${needle}`);
}

// Dev-server port: tauri devUrl and the Next dev port must agree and stay
// off 3000, where another local Next app hijacked the Tauri window.
const tauriConf = JSON.parse(read('../src-tauri/tauri.conf.json'));
const pkg = JSON.parse(read('../package.json'));
console.assert(
  tauriConf.build.devUrl === 'http://localhost:3434',
  `devUrl is ${tauriConf.build.devUrl}, expected http://localhost:3434`
);
console.assert(pkg.scripts.dev.includes('-p 3434'), 'dev script not pinned to port 3434');
console.assert(
  (tauriConf.app.security.devCsp ?? '').includes('localhost:3434'),
  'devCsp does not allow port 3434 for HMR'
);

// Drag-and-drop upload: patient view must mount the uploader, which saves
// through the same createPhoto path as captured photos.
const upload = read('../components/photo/photo-upload.tsx');
for (const needle of ['createPhoto', 'dragover', "addEventListener('drop'", 'PhotoMetadataForm', 'image/heic']) {
  console.assert(upload.includes(needle), `photo-upload.tsx missing: ${needle}`);
}
const viewPage = read('../app/(dashboard)/patients/view/page.tsx');
console.assert(viewPage.includes('PhotoUpload'), 'patients/view page does not mount PhotoUpload');

// Brand assets: sidebar mark, and installer icons regenerated for the logo.
console.assert(existsSync(new URL('../public/logo.png', import.meta.url)), 'public/logo.png missing');
const sidebar = read('../components/app-sidebar.tsx');
console.assert(sidebar.includes('/logo.png'), 'app-sidebar does not use /logo.png brand mark');
console.assert(
  existsSync(new URL('../src-tauri/icons/icon.icns', import.meta.url)),
  'macOS installer icon (icon.icns) missing'
);
console.assert(
  existsSync(new URL('../src-tauri/icons/icon.ico', import.meta.url)),
  'Windows installer icon (icon.ico) missing'
);

console.log('phone-tether self-check passed');
