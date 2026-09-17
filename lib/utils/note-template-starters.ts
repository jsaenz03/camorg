/**
 * The starter note templates seeded for each clinician on first use.
 *
 * Deliberately dependency-free so scripts/self-check-note-templates.mjs can
 * import and pin the set directly. Eight distinct clinical scenarios — no two
 * about the same follow-up situation — with the {date}, {patient} and
 * {bodypart} tokens demonstrated across the samples. Shortcuts on a few
 * starters showcase type-to-expand; they are deliberately non-words so they
 * never fire mid-sentence.
 */

export interface StarterTemplate {
  /** Stable seed key: the row id is uuidv5(clinicianId + slug, NAMESPACE),
   *  so re-seeding and restoring dedupe against themselves. */
  slug: string;
  title: string;
  body: string;
  shortcut?: string;
}

/** Fixed namespace for the deterministic starter ids (any UUID works; it
 *  just has to never change, or existing seeds stop being recognised). */
export const STARTER_NAMESPACE = '4d2f7ac0-91b1-4a2e-8a9e-5c0b6f1d3e77';

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    slug: 'no-change',
    title: 'No change',
    shortcut: 'ncp',
    body: 'Reviewed {date} — no change since the previous photo; lesion stable in size, shape and colour.',
  },
  {
    slug: 'increased-size',
    title: 'Increased in size',
    body: 'Lesion has increased in size since the previous photo; review recommended.',
  },
  {
    slug: 'colour-border',
    title: 'Colour or border change',
    body: 'Change in colour or border noted; monitor closely and consider earlier review.',
  },
  {
    slug: 'benign',
    title: 'Benign — no intervention',
    body: 'Benign-appearing lesion; no intervention required at this time.',
  },
  {
    slug: 'no-symptoms',
    title: 'No symptoms',
    shortcut: 'nsy',
    body: '{patient} reports no pain, itching or bleeding at the {bodypart} site.',
  },
  {
    slug: 'wound-healing',
    title: 'Wound healing',
    body: 'Wound healing well; no signs of infection.',
  },
  {
    slug: 'baseline',
    title: 'Baseline recorded',
    shortcut: 'bsl',
    body: 'Baseline photo of the {bodypart} recorded for comparison; follow-up photo recommended in 3 months.',
  },
  {
    slug: 'referral',
    title: 'Referral note',
    body: 'Photos of the {bodypart} forwarded for specialist opinion on {date}.',
  },
];
