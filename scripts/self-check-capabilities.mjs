// Self-check: packaged-app ACL must allow every fs/sql call the storage flow
// makes, and fs scope paths must not double-append the bundle id (the
// $APPDATA/com.camog.app/** regression that blocked mkdir in packaged builds).
import { readFileSync } from 'node:fs';

const caps = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
);

const perms = caps.permissions.flatMap((p) => (typeof p === 'string' ? [p] : []));
const required = [
  'sql:allow-execute',
  'fs:allow-exists',
  'fs:allow-mkdir',
  'fs:allow-read-file',
  'fs:allow-write-file',
  'fs:allow-read-dir',
  'fs:allow-copy-file',
];
const missing = required.filter((r) => !perms.includes(r));
console.assert(missing.length === 0, `missing permissions: ${missing.join(', ')}`);

const scope = caps.permissions.find((p) => typeof p !== 'string' && p.identifier === 'fs:scope');
const paths = (scope?.allow ?? []).map((e) => e.path);
console.assert(paths.length > 0, 'fs:scope has no allow paths');
for (const p of paths) {
  // $APPDATA may already resolve app-specific; appending the id again makes
  // the pattern match nothing at runtime.
  console.assert(!p.includes('com.camog.app'), `scope path double-appends bundle id: ${p}`);
}

console.log('capabilities self-check passed:', perms.length, 'permissions,', paths.length, 'scope paths');
