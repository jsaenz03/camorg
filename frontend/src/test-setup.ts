// Test setup file for vitest
import { beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Mock global window services for integration tests
declare global {
  interface Window {
    patientService: any;
    photoService: any;
    bodyPartService: any;
    exportService: any;
    databaseService: any;
    syncService: any;
  }
}

beforeEach(() => {
  // Clear IndexedDB between tests
  if (global.indexedDB) {
    const DBDeleteRequest = global.indexedDB.deleteDatabase('dermatology-clinic');
    DBDeleteRequest.onsuccess = () => {
      // Database deleted successfully
    };
  }
});