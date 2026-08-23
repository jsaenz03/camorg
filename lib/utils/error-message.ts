/**
 * Extract a human-readable message from an unknown rejection.
 *
 * Tauri plugin IPC failures often reject with plain strings (not Error
 * instances), which `err instanceof Error ? err.message : 'Set up failed'`
 * patterns reduce to a useless generic fallback. This keeps the real cause
 * visible in toasts.
 */

export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    const s = JSON.stringify(err);
    return s && s !== 'null' && s !== 'undefined' ? s : fallback;
  } catch {
    return fallback;
  }
}
