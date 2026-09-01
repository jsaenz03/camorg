/**
 * Attention-change event plumbing, in a dependency-free leaf module so every
 * service that mutates the rows the alert counts derive from can fire it
 * without importing notification-service (whose imports would cycle back
 * through those same services). notification-service re-exports both names,
 * so existing consumers are unaffected.
 */

export const ATTENTION_CHANGED_EVENT = 'camog:attention-changed';

/** Fired on window whenever a review-affecting action lands, so open
 * consumers (sidebar, dashboard) refetch immediately instead of waiting
 * for their poll tick. */
export function notifyAttentionChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ATTENTION_CHANGED_EVENT));
  }
}
