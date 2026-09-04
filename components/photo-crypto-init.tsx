'use client';

/**
 * Kicks off the one-time at-rest encryption migration for photos captured
 * before encryption shipped (see lib/services/photo-crypto-migration.ts).
 * Background work only — new captures are already encrypted at write time.
 * Renders nothing. No-op outside the Tauri webview (plain browser preview).
 */

import { useEffect } from 'react';

export function PhotoCryptoInit() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    void import('@/lib/services/photo-crypto-migration').then(({ runPhotoEncryptionMigration }) =>
      runPhotoEncryptionMigration(),
    );
  }, []);
  return null;
}
