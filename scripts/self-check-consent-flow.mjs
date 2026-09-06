/**
 * Self-check for the consent flow: every surface that saves a photo for a
 * patient without valid consent must offer consent recording in place —
 * the capture flow (new and existing patients), the upload batch, and the
 * timeline's consent banner — instead of pointing at "Edit details" on
 * another page. Backed by the focused recordConsent service method, which
 * stamps given-at now and audits with the same wording as updatePatient.
 *
 * Run: node scripts/self-check-consent-flow.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const serviceSrc = read('../lib/services/patient-service.ts');
const dialogSrc = read('../components/patient/record-consent-dialog.tsx');
const captureSrc = read('../components/capture/capture-dialog.tsx');
const timelineSrc = read('../app/(dashboard)/patients/view/page.tsx');
const uploadSrc = read('../components/photo/photo-upload.tsx');
const badgeSrc = read('../components/patient/consent-badge.tsx');

// --- Service: focused consent write, given-at now, audited ---

assert.match(serviceSrc, /async recordConsent\(/, 'patient-service has recordConsent');
assert.match(
  serviceSrc,
  /SET consent_given_at = \$1, consent_scope = \$2, consent_expires_at = \$3/,
  'recordConsent writes only the consent columns (+updated_at)',
);
assert.match(
  serviceSrc,
  /\[consent\.scope \? nowMs : null, consent\.scope, expiresMs, nowMs, id\]/,
  'recordConsent stamps consent_given_at as now',
);
assert.match(
  serviceSrc,
  /auditService\.record\('patient\.consent'[\s\S]*?consent recorded \(/,
  'recordConsent audits with the updatePatient wording',
);
assert.match(
  serviceSrc,
  /assertCanManagePatient\(id\);\s*\n\s*const db = await getDB\(\);\s*\n\s*const rows = await db\.select<Record<string, unknown>\[\]>\(\s*\n\s*`SELECT \$\{PATIENT_COLUMNS\}[\s\S]*?recordConsent/,
  'recordConsent sits behind the access-control guard',
);

// --- Shared dialog: scope + optional expiry, skippable ---

assert.match(dialogSrc, /patientService\.recordConsent\(/, 'dialog saves via recordConsent');
assert.match(dialogSrc, /Expiry must be in the future/, 'dialog rejects past expiry');
assert.match(dialogSrc, /Not now/, 'dialog is skippable');
assert.match(
  dialogSrc,
  /consentStatus\(patient\) === 'expired'/,
  'dialog reads expired vs missing from the patient',
);

// --- Capture: prompt opens post-save for existing AND newly created patients ---

assert.match(captureSrc, /needsConsent = exactMatch/, 'existing patient without consent prompts');
assert.match(captureSrc, /needsConsent = newPatient/, 'newly created patient prompts');
assert.match(
  captureSrc,
  /if \(needsConsent\) \{\s*\n\s*setConsentPatient\(needsConsent\);\s*\n\s*setConsentOpen\(true\);\s*\n\s*return;\s*\n\s*\}/,
  'consent prompt defers the hand-off to the patient page',
);
assert.doesNotMatch(captureSrc, /Edit details\)\./, 'old dead-end toast copy is gone');

// The prompt's close handler finishes the deferred hand-off — refresh or
// navigate — so the timeline is always fetched after the consent decision
// and never shows a stale "no consent" banner over a just-recorded consent.
const promptBlock = captureSrc.match(/<RecordConsentDialog[\s\S]*?\/>/);
assert.ok(promptBlock, 'capture renders the consent prompt');
assert.match(
  promptBlock[0],
  /open=\{consentOpen\}/,
  'capture prompt is explicitly controlled (never unmounted while open)',
);
assert.match(
  promptBlock[0],
  /onOpenChange=[\s\S]*?if \(onSaved\) \{[\s\S]*?onSaved\(consentPatient\.id\);[\s\S]*?\} else \{[\s\S]*?router\.push\(`\/patients\/view\?id=\$\{consentPatient\.id\}`\)/,
  'prompt close refreshes in place or navigates to the patient',
);

// --- Timeline: banner carries the record action and refreshes on save ---

assert.match(timelineSrc, /setIsConsentOpen\(true\)/, 'banner button opens the dialog');
assert.match(timelineSrc, /onSaved=\{setPatient\}/, 'banner save refreshes the header/badge');
// The exact regression: the dialog once carried a remount key that collided
// with EditPatientDialog's `${id}:${updatedAt}` key — duplicate sibling keys
// corrupted reconciliation and orphaned the OPEN dialog (stuck "Saving…",
// pointer-events locked). The dialog must never carry a remount key; field
// freshness comes from the open-transition reset inside the component.
const timelineDialog = timelineSrc.match(/<RecordConsentDialog[\s\S]*?\/>/);
assert.ok(timelineDialog, 'timeline renders the consent dialog');
assert.doesNotMatch(timelineDialog[0], /key=/, 'consent dialog has no remount key');
assert.match(
  dialogSrc,
  /useEffect\(\(\) => \{\s*\n\s*if \(open\)/,
  'dialog re-initialises its fields on open (instead of a remount key)',
);
assert.match(
  timelineSrc,
  /Record new consent|Record consent/,
  'banner names the action',
);

// --- Toasts stack fully instead of covering each other ---

const layoutSrc = read('../app/layout.tsx');
assert.match(layoutSrc, /<Toaster richColors expand visibleToasts=\{3\} \/>/, 'toaster shows up to 3 fully stacked');

// --- Playwright spec pins the browser-level behavior end to end ---

const specSrc = read('../tests/consent-dialog.spec.ts');
assert.match(specSrc, /toHaveCount\(0/, 'spec asserts the dialog leaves the DOM after save');
assert.match(specSrc, /pointer-events/, 'spec asserts the scroll lock releases');

// --- Upload: batch finish prompts when consent is not valid ---

assert.match(
  uploadSrc,
  /consentStatus\(patient\) !== 'valid'/,
  'upload checks consent after the batch',
);
assert.match(uploadSrc, /setIsConsentOpen\(true\)/, 'upload opens the dialog');

// --- Badges point at the actionable banner, not at Edit details ---

assert.doesNotMatch(badgeSrc, /Edit details/, 'ConsentBadge no longer says Edit details');
assert.doesNotMatch(timelineSrc, /record new consent in Edit details/, 'header badge copy updated');

console.log('consent flow self-check passed');
