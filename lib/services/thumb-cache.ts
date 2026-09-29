/**
 * In-memory LRU cache of decrypted thumbnail data URLs.
 *
 * Every thumbnail shown in a grid used to run the full pipeline per photo —
 * row select, access checks, fs read, decrypt command, three base64 passes
 * (~6-7 IPC round-trips) — with no caching, so navigating back to a timeline
 * or any count-affecting mutation (which fires a refresh) re-decrypted the
 * whole set. Thumbnails are immutable per photo id (images never change;
 * annotation saves create a new photo), so the bytes are safe to keep.
 *
 * Privacy: entries are 200×200 patient images held in webview memory only —
 * the same lifetime class as the <img> that just displayed them. The cache
 * is cleared on logout and when photos/patients are deleted. ponytail: no
 * per-entry ACL recheck, so a share revoked mid-session could keep serving
 * an already-shown thumbnail until eviction; upgrade path is keying entries
 * by clinician+patient and dropping the set on access changes.
 */

const MAX_ENTRIES = 200;

const cache = new Map<string, string>();

export function getCachedThumb(id: string): string | undefined {
  const hit = cache.get(id);
  if (hit !== undefined) {
    // Recency bump: delete + re-insert moves the key to the back.
    cache.delete(id);
    cache.set(id, hit);
  }
  return hit;
}

export function putCachedThumb(id: string, dataUrl: string): void {
  if (cache.has(id)) cache.delete(id);
  cache.set(id, dataUrl);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function evictCachedThumb(id: string): void {
  cache.delete(id);
}

export function clearThumbCache(): void {
  cache.clear();
}
