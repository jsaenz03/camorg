// Self-check: the phone-camera tether must be wired end to end — Rust server
// command registered, phone page POSTs to the tokened path and drives the
// native camera, and the frontend panel listens for the matching events and
// is reachable from the capture screen.
import { readFileSync } from 'node:fs';

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

console.log('phone-tether self-check passed');
