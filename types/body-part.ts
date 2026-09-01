/**
 * Standardized anatomical regions for categorizing photos
 */
export enum BodyPart {
  HEAD = 'head',
  FACE = 'face',
  SCALP = 'scalp',
  NECK = 'neck',
  CHEST = 'chest',
  ABDOMEN = 'abdomen',
  BACK = 'back',
  UPPER_ARM = 'upper_arm',
  FOREARM = 'forearm',
  HAND = 'hand',
  THIGH = 'thigh',
  LEG = 'leg',
  FOOT = 'foot',
  TORSO = 'torso',
}

/**
 * Array of all body parts for iteration
 */
export const BODY_PARTS = Object.values(BodyPart);

/**
 * Display labels for UI
 */
export const BodyPartLabels: Record<BodyPart, string> = {
  [BodyPart.HEAD]: 'Head',
  [BodyPart.FACE]: 'Face',
  [BodyPart.SCALP]: 'Scalp',
  [BodyPart.NECK]: 'Neck',
  [BodyPart.CHEST]: 'Chest',
  [BodyPart.ABDOMEN]: 'Abdomen',
  [BodyPart.BACK]: 'Back',
  [BodyPart.UPPER_ARM]: 'Upper Arm',
  [BodyPart.FOREARM]: 'Forearm',
  [BodyPart.HAND]: 'Hand',
  [BodyPart.THIGH]: 'Thigh',
  [BodyPart.LEG]: 'Leg',
  [BodyPart.FOOT]: 'Foot',
  [BodyPart.TORSO]: 'Torso',
};

/**
 * Which side of the patient a photo belongs to (patient's own left/right,
 * always — never the viewer's). Null for central regions and legacy rows.
 */
export type Laterality = 'left' | 'right';

export const LateralityLabels: Record<Laterality, string> = {
  left: 'Left',
  right: 'Right',
};

/** Regions that come in pairs; only these offer the left/right choice. */
export const BILATERAL_BODY_PARTS: ReadonlySet<BodyPart> = new Set([
  BodyPart.UPPER_ARM,
  BodyPart.FOREARM,
  BodyPart.HAND,
  BodyPart.THIGH,
  BodyPart.LEG,
  BodyPart.FOOT,
]);

/** "Left hand", "Face" — laterality prefixed when present. */
export function bodyPartDisplayLabel(
  bodyPart: BodyPart,
  laterality: Laterality | null = null,
): string {
  const label = BodyPartLabels[bodyPart] ?? bodyPart;
  return laterality ? `${LateralityLabels[laterality]} ${label}` : label;
}

/**
 * Which face of the patient a diagram shows. Front = anterior surfaces (palm
 * of the hand, top of the foot, face); back = posterior (back of the hand,
 * sole, back/trunk). Also the body map's silhouette toggle.
 */
export type BodyView = 'front' | 'back';

export type PinpointSpace = 'body' | 'part';

/**
 * Exact pinpoint mark (the X) on a body-map diagram, normalized 0..1 within
 * the diagram it was placed on. 'body' = whole-body map; 'part' = the body
 * part's own zoomed detail diagram (finer, supersedes a body-level mark).
 * 'view' records which face the X was marked on — for hands and feet the
 * front/back detail diagrams differ (palm vs back of hand), so a pin without
 * it is ambiguous.
 */
export interface Pinpoint {
  x: number;
  y: number;
  space: PinpointSpace;
  view: BodyView;
}

/** What the front/back faces of a part are called, for parts where they differ. */
export const SURFACE_LABELS: Partial<Record<BodyPart, Record<BodyView, string>>> = {
  [BodyPart.HAND]: { front: 'Palm', back: 'Back of hand' },
  [BodyPart.FOOT]: { front: 'Top of foot', back: 'Sole' },
};

/** Surface name for a part+view, or null when the part has no distinct faces. */
export function surfaceLabelFor(part: BodyPart, view: BodyView): string | null {
  return SURFACE_LABELS[part]?.[view] ?? null;
}

/** "Left hand — palm": display label with the surface spelled out when the
    part's front/back faces differ (hands, feet). */
export function bodyPartSurfaceLabel(
  bodyPart: BodyPart,
  laterality: Laterality | null = null,
  view: BodyView = 'front',
): string {
  const surface = surfaceLabelFor(bodyPart, view);
  const base = bodyPartDisplayLabel(bodyPart, laterality);
  return surface ? `${base} — ${surface.toLowerCase()}` : base;
}
