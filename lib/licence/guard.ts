/**
 * Licence write guard — the choke point read-only enforcement.
 *
 * Mutating service methods call ensureWritable() first; UI surfaces subscribe
 * via onLicenceBlocked() to open the activation dialog when a guard trips.
 * Kept in its own module so services and React context can both import it
 * without cycles.
 */

import { licenceService } from '@/lib/services/licence-service';
import { LicenceReadOnlyError } from '@/lib/validators/errors';

type BlockedListener = () => void;

const listeners = new Set<BlockedListener>();

/** Subscribe to guard trips (e.g. to open the activation dialog). */
export function onLicenceBlocked(fn: BlockedListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Throws LicenceReadOnlyError when the install is read-only (trial over or
 * licence expired), notifying listeners first so the activation UI opens.
 */
export async function ensureWritable(): Promise<void> {
  if (!(await licenceService.isWritable())) {
    listeners.forEach((fn) => fn());
    throw new LicenceReadOnlyError(
      'Camog is in read-only mode. Activate a licence to capture or edit.'
    );
  }
}
