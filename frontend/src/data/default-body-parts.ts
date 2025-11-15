/**
 * Default body parts template for dermatology photo organization
 * Hierarchical structure with major anatomical regions
 * Left/Right distinctions included where appropriate
 */

export interface BodyPartTemplate {
  name: string;
  displayOrder: number;
  children?: BodyPartTemplate[];
}

/**
 * Standard body part hierarchy for dermatology applications
 */
export const DEFAULT_BODY_PARTS: BodyPartTemplate[] = [
  // HEAD & NECK
  {
    name: 'Head & Neck',
    displayOrder: 1,
    children: [
      { name: 'Scalp', displayOrder: 1 },
      { name: 'Forehead', displayOrder: 2 },
      { name: 'Left Temple', displayOrder: 3 },
      { name: 'Right Temple', displayOrder: 4 },
      { name: 'Left Eye Area', displayOrder: 5 },
      { name: 'Right Eye Area', displayOrder: 6 },
      { name: 'Nose', displayOrder: 7 },
      { name: 'Left Cheek', displayOrder: 8 },
      { name: 'Right Cheek', displayOrder: 9 },
      { name: 'Left Ear', displayOrder: 10 },
      { name: 'Right Ear', displayOrder: 11 },
      { name: 'Lips', displayOrder: 12 },
      { name: 'Chin', displayOrder: 13 },
      { name: 'Jaw', displayOrder: 14 },
      { name: 'Neck - Front', displayOrder: 15 },
      { name: 'Neck - Back', displayOrder: 16 },
      { name: 'Neck - Left Side', displayOrder: 17 },
      { name: 'Neck - Right Side', displayOrder: 18 },
    ],
  },

  // TORSO
  {
    name: 'Torso',
    displayOrder: 2,
    children: [
      { name: 'Chest', displayOrder: 1 },
      { name: 'Abdomen', displayOrder: 2 },
      { name: 'Upper Back', displayOrder: 3 },
      { name: 'Lower Back', displayOrder: 4 },
      { name: 'Left Shoulder', displayOrder: 5 },
      { name: 'Right Shoulder', displayOrder: 6 },
      { name: 'Left Side', displayOrder: 7 },
      { name: 'Right Side', displayOrder: 8 },
    ],
  },

  // UPPER EXTREMITIES
  {
    name: 'Upper Extremities',
    displayOrder: 3,
    children: [
      // Left Arm
      {
        name: 'Left Arm',
        displayOrder: 1,
        children: [
          { name: 'Left Upper Arm - Front', displayOrder: 1 },
          { name: 'Left Upper Arm - Back', displayOrder: 2 },
          { name: 'Left Elbow', displayOrder: 3 },
          { name: 'Left Forearm - Front', displayOrder: 4 },
          { name: 'Left Forearm - Back', displayOrder: 5 },
          { name: 'Left Wrist', displayOrder: 6 },
        ],
      },
      // Right Arm
      {
        name: 'Right Arm',
        displayOrder: 2,
        children: [
          { name: 'Right Upper Arm - Front', displayOrder: 1 },
          { name: 'Right Upper Arm - Back', displayOrder: 2 },
          { name: 'Right Elbow', displayOrder: 3 },
          { name: 'Right Forearm - Front', displayOrder: 4 },
          { name: 'Right Forearm - Back', displayOrder: 5 },
          { name: 'Right Wrist', displayOrder: 6 },
        ],
      },
      // Left Hand
      {
        name: 'Left Hand',
        displayOrder: 3,
        children: [
          { name: 'Left Palm', displayOrder: 1 },
          { name: 'Left Back of Hand', displayOrder: 2 },
          { name: 'Left Thumb', displayOrder: 3 },
          { name: 'Left Index Finger', displayOrder: 4 },
          { name: 'Left Middle Finger', displayOrder: 5 },
          { name: 'Left Ring Finger', displayOrder: 6 },
          { name: 'Left Pinky Finger', displayOrder: 7 },
        ],
      },
      // Right Hand
      {
        name: 'Right Hand',
        displayOrder: 4,
        children: [
          { name: 'Right Palm', displayOrder: 1 },
          { name: 'Right Back of Hand', displayOrder: 2 },
          { name: 'Right Thumb', displayOrder: 3 },
          { name: 'Right Index Finger', displayOrder: 4 },
          { name: 'Right Middle Finger', displayOrder: 5 },
          { name: 'Right Ring Finger', displayOrder: 6 },
          { name: 'Right Pinky Finger', displayOrder: 7 },
        ],
      },
    ],
  },

  // LOWER EXTREMITIES
  {
    name: 'Lower Extremities',
    displayOrder: 4,
    children: [
      // Left Leg
      {
        name: 'Left Leg',
        displayOrder: 1,
        children: [
          { name: 'Left Hip', displayOrder: 1 },
          { name: 'Left Thigh - Front', displayOrder: 2 },
          { name: 'Left Thigh - Back', displayOrder: 3 },
          { name: 'Left Knee', displayOrder: 4 },
          { name: 'Left Lower Leg - Front', displayOrder: 5 },
          { name: 'Left Lower Leg - Back', displayOrder: 6 },
          { name: 'Left Ankle', displayOrder: 7 },
        ],
      },
      // Right Leg
      {
        name: 'Right Leg',
        displayOrder: 2,
        children: [
          { name: 'Right Hip', displayOrder: 1 },
          { name: 'Right Thigh - Front', displayOrder: 2 },
          { name: 'Right Thigh - Back', displayOrder: 3 },
          { name: 'Right Knee', displayOrder: 4 },
          { name: 'Right Lower Leg - Front', displayOrder: 5 },
          { name: 'Right Lower Leg - Back', displayOrder: 6 },
          { name: 'Right Ankle', displayOrder: 7 },
        ],
      },
      // Left Foot
      {
        name: 'Left Foot',
        displayOrder: 3,
        children: [
          { name: 'Left Foot - Top', displayOrder: 1 },
          { name: 'Left Foot - Bottom', displayOrder: 2 },
          { name: 'Left Heel', displayOrder: 3 },
          { name: 'Left Big Toe', displayOrder: 4 },
          { name: 'Left Toes', displayOrder: 5 },
        ],
      },
      // Right Foot
      {
        name: 'Right Foot',
        displayOrder: 4,
        children: [
          { name: 'Right Foot - Top', displayOrder: 1 },
          { name: 'Right Foot - Bottom', displayOrder: 2 },
          { name: 'Right Heel', displayOrder: 3 },
          { name: 'Right Big Toe', displayOrder: 4 },
          { name: 'Right Toes', displayOrder: 5 },
        ],
      },
    ],
  },

  // GROIN & BUTTOCKS
  {
    name: 'Groin & Buttocks',
    displayOrder: 5,
    children: [
      { name: 'Groin - Left', displayOrder: 1 },
      { name: 'Groin - Right', displayOrder: 2 },
      { name: 'Buttocks - Left', displayOrder: 3 },
      { name: 'Buttocks - Right', displayOrder: 4 },
      { name: 'Gluteal Fold', displayOrder: 5 },
    ],
  },

  // OTHER
  {
    name: 'Other',
    displayOrder: 6,
    children: [
      { name: 'General/Full Body', displayOrder: 1 },
      { name: 'Unspecified Location', displayOrder: 2 },
    ],
  },
];

/**
 * Get count of all body parts including children
 */
export function getTotalBodyPartsCount(): number {
  let count = 0;

  function countRecursive(parts: BodyPartTemplate[]): void {
    parts.forEach(part => {
      count++;
      if (part.children) {
        countRecursive(part.children);
      }
    });
  }

  countRecursive(DEFAULT_BODY_PARTS);
  return count;
}

/**
 * Get flattened list of all body part names
 */
export function getAllBodyPartNames(): string[] {
  const names: string[] = [];

  function collectNames(parts: BodyPartTemplate[], prefix = ''): void {
    parts.forEach(part => {
      const fullName = prefix ? `${prefix} > ${part.name}` : part.name;
      names.push(fullName);
      if (part.children) {
        collectNames(part.children, fullName);
      }
    });
  }

  collectNames(DEFAULT_BODY_PARTS);
  return names;
}
