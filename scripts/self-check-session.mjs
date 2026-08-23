// Self-check for remember-me sessions + personal auto-logout
// (lib/services/auth-service.ts). Run: node scripts/self-check-session.mjs
// ponytail: mirrors the pure helpers in auth-service.ts because Node cannot
// import the TS module graph directly; if you change them, update the mirror
// here. Upgrade path: run via tsx/ts-node in CI.

import assert from 'node:assert/strict';

const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

function sanitiseAutoLogoutTimeout(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function resolveSessionTimeoutMs(userMs, orgMs) {
  return userMs ?? orgMs;
}

function expiryFromTimeout(timeoutMs, nowMs = Date.now()) {
  return timeoutMs === 0 ? NEVER_EXPIRES : nowMs + timeoutMs;
}

// Fake web storage to verify the remember-me placement rules.
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const SESSION_KEY = 'camog.session';

function makeStorages() {
  return { sessionStorage: fakeStorage(), localStorage: fakeStorage() };
}

// Mirrors writeSession: always clears both, writes to the chosen one.
function writeSession(storages, session) {
  storages.sessionStorage.removeItem(SESSION_KEY);
  storages.localStorage.removeItem(SESSION_KEY);
  if (session) {
    const target = session.remember ? storages.localStorage : storages.sessionStorage;
    target.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

// Mirrors readSession: sessionStorage first, then remembered localStorage.
// Malformed payloads return null (whole body inside try, like the service).
function readSession(storages) {
  try {
    const raw =
      storages.sessionStorage.getItem(SESSION_KEY) ??
      storages.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.clinicianId || typeof parsed.expiresAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ----- sanitiser: trust boundary for the stored preference -----

assert.equal(sanitiseAutoLogoutTimeout(null), null);
assert.equal(sanitiseAutoLogoutTimeout(undefined), null);
assert.equal(sanitiseAutoLogoutTimeout('3600000'), null); // string junk → default
assert.equal(sanitiseAutoLogoutTimeout(-1), null); // negative → default
assert.equal(sanitiseAutoLogoutTimeout(Number.NaN), null);
assert.equal(sanitiseAutoLogoutTimeout(0), 0); // 0 = never, stays 0
assert.equal(sanitiseAutoLogoutTimeout(3_600_000.9), 3_600_000); // floors

// ----- effective timeout: user choice wins, else org default -----

assert.equal(resolveSessionTimeoutMs(null, 1_800_000), 1_800_000); // default
assert.equal(resolveSessionTimeoutMs(0, 1_800_000), 0); // never
assert.equal(resolveSessionTimeoutMs(60_000, 1_800_000), 60_000); // override

// ----- expiry: 0 = never sentinel, otherwise now + timeout -----

assert.equal(expiryFromTimeout(0), NEVER_EXPIRES);
assert.equal(expiryFromTimeout(1_000, 5_000), 6_000);
assert.ok(expiryFromTimeout(1_000, 5_000) !== NEVER_EXPIRES);

// ----- storage placement -----

// Plain session lives in sessionStorage only.
const s1 = makeStorages();
writeSession(s1, { clinicianId: 'a', expiresAt: 9 });
assert.ok(s1.sessionStorage.getItem(SESSION_KEY));
assert.equal(s1.localStorage.getItem(SESSION_KEY), null);

// Remembered session lives in localStorage only.
const s2 = makeStorages();
writeSession(s2, { clinicianId: 'a', expiresAt: 9, remember: true });
assert.equal(s2.sessionStorage.getItem(SESSION_KEY), null);
assert.ok(s2.localStorage.getItem(SESSION_KEY), 'remembered session persisted');

// A remembered session survives a "restart" (sessionStorage wiped).
const remembered = readSession(s2);
s2.sessionStorage._map.clear();
assert.equal(readSession(s2)?.clinicianId, 'a');
assert.equal(readSession(s2)?.remember, true);

// Switching storage clears the stale copy in the other one.
writeSession(s2, { clinicianId: 'b', expiresAt: 9 });
assert.equal(readSession(s2)?.clinicianId, 'b', 'sessionStorage shadows localStorage');
assert.equal(s2.localStorage.getItem(SESSION_KEY), null, 'stale remembered copy gone');

// Logout clears both storages.
const s3 = makeStorages();
writeSession(s3, { clinicianId: 'a', expiresAt: 9, remember: true });
writeSession(s3, null);
assert.equal(readSession(s3), null);
assert.equal(s3.sessionStorage.getItem(SESSION_KEY), null);
assert.equal(s3.localStorage.getItem(SESSION_KEY), null);

// Malformed stored JSON is ignored rather than thrown.
const s4 = makeStorages();
s4.localStorage.setItem(SESSION_KEY, '{not json');
assert.equal(readSession(s4), null);

// ----- remembered sign-in details (login-form prefill) -----

const REMEMBERED_KEY = 'camog.rememberedLogin';

// Mirrors readRememberedLogin: shape-checked, malformed JSON → null.
function readRememberedLogin(storages) {
  try {
    const raw = storages.localStorage.getItem(REMEMBERED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.username !== 'string' || typeof parsed?.passcode !== 'string') {
      return null;
    }
    return { username: parsed.username, passcode: parsed.passcode };
  } catch {
    return null;
  }
}

function clearStaleRememberedLogin(storages, attempted) {
  const remembered = readRememberedLogin(storages);
  if (
    remembered &&
    remembered.username === attempted.username &&
    remembered.passcode === attempted.passcode
  ) {
    storages.localStorage.removeItem(REMEMBERED_KEY);
  }
}

const s5 = makeStorages();
s5.localStorage.setItem(
  REMEMBERED_KEY,
  JSON.stringify({ username: 'dr@example.com', passcode: 'old-pass' }),
);

// A failed attempt using the remembered pair (stale) drops the prefill…
clearStaleRememberedLogin(s5, { username: 'dr@example.com', passcode: 'old-pass' });
assert.equal(readRememberedLogin(s5), null);

// …but a failed attempt with different values (user retyping) keeps it.
s5.localStorage.setItem(
  REMEMBERED_KEY,
  JSON.stringify({ username: 'dr@example.com', passcode: 'old-pass' }),
);
clearStaleRememberedLogin(s5, { username: 'dr@example.com', passcode: 'typo' });
assert.deepEqual(readRememberedLogin(s5), {
  username: 'dr@example.com',
  passcode: 'old-pass',
});

// Malformed stored details are ignored rather than thrown.
const s6 = makeStorages();
s6.localStorage.setItem(REMEMBERED_KEY, '{not json');
assert.equal(readRememberedLogin(s6), null);
s6.localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ username: 42 }));
assert.equal(readRememberedLogin(s6), null);

console.log('self-check-session: remember-me + auto-logout assertions passed');
