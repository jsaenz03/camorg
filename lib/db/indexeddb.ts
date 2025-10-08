import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { STORES, DB_NAME, DB_VERSION } from './schema';
import type { PhotoRecord } from '@/types/photo';
import type { Patient } from '@/types/patient';
import type { SubpartSuggestion } from '@/types/subpart';
import type { Clinician } from '@/types/clinician';

/**
 * IndexedDB schema definition for CamogDB
 */
interface CamogDBSchema extends DBSchema {
  [STORES.PHOTOS]: {
    key: string;
    value: PhotoRecord;
    indexes: {
      patientId: string;
      patientId_capturedAt: [string, Date];
      patientId_bodyPart: [string, string];
      clinicianId: string;
      isDeleted: boolean;
    };
  };
  [STORES.PATIENTS]: {
    key: string;
    value: Patient;
    indexes: {
      normalizedName: string;
      clinicianId: string;
      isArchived: boolean;
    };
  };
  [STORES.SUBPARTS]: {
    key: string;
    value: SubpartSuggestion;
    indexes: {
      bodyPart: string;
      bodyPart_subpart: [string, string];
      clinicianId: string;
    };
  };
  [STORES.CLINICIANS]: {
    key: string;
    value: Clinician;
    indexes: {
      username: string;
    };
  };
}

let dbInstance: IDBPDatabase<CamogDBSchema> | null = null;

/**
 * Get or create the IndexedDB instance
 * Automatically creates all stores and indexes on first run or version upgrade
 */
export async function getDB(): Promise<IDBPDatabase<CamogDBSchema>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<CamogDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`Upgrading DB from version ${oldVersion} to ${newVersion}`);

      // Create photos store
      if (!db.objectStoreNames.contains(STORES.PHOTOS)) {
        const photoStore = db.createObjectStore(STORES.PHOTOS, { keyPath: 'id' });
        photoStore.createIndex('patientId', 'patientId', { unique: false });
        photoStore.createIndex('patientId_capturedAt', ['patientId', 'capturedAt'], { unique: false });
        photoStore.createIndex('patientId_bodyPart', ['patientId', 'bodyPart'], { unique: false });
        photoStore.createIndex('clinicianId', 'clinicianId', { unique: false });
        photoStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      }

      // Create patients store
      if (!db.objectStoreNames.contains(STORES.PATIENTS)) {
        const patientStore = db.createObjectStore(STORES.PATIENTS, { keyPath: 'id' });
        patientStore.createIndex('normalizedName', 'normalizedName', { unique: false });
        patientStore.createIndex('clinicianId', 'clinicianId', { unique: false });
        patientStore.createIndex('isArchived', 'isArchived', { unique: false });
      }

      // Create subparts store
      if (!db.objectStoreNames.contains(STORES.SUBPARTS)) {
        const subpartStore = db.createObjectStore(STORES.SUBPARTS, { keyPath: 'id' });
        subpartStore.createIndex('bodyPart', 'bodyPart', { unique: false });
        subpartStore.createIndex('bodyPart_subpart', ['bodyPart', 'subpart'], { unique: true });
        subpartStore.createIndex('clinicianId', 'clinicianId', { unique: false });
      }

      // Create clinicians store
      if (!db.objectStoreNames.contains(STORES.CLINICIANS)) {
        const clinicianStore = db.createObjectStore(STORES.CLINICIANS, { keyPath: 'id' });
        clinicianStore.createIndex('username', 'username', { unique: true });
      }
    },
  });

  return dbInstance;
}

/**
 * Close the database connection
 */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Delete the database (for testing or reset functionality)
 */
export async function deleteDB(): Promise<void> {
  closeDB();
  await indexedDB.deleteDatabase(DB_NAME);
}
