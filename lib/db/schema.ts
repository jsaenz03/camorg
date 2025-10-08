/**
 * IndexedDB schema configuration
 */

export const DB_NAME = 'CamogDB';
export const DB_VERSION = 1;

export const STORES = {
  PHOTOS: 'photos',
  PATIENTS: 'patients',
  SUBPARTS: 'subparts',
  CLINICIANS: 'clinicians',
} as const;

export type StoreNames = (typeof STORES)[keyof typeof STORES];
