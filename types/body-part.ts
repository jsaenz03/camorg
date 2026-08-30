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
