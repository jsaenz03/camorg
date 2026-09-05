/**
 * Capture dedupe for phone photo deliveries.
 *
 * The phone's network stack can silently resend a photo POST (a transport
 * retry on a dropped keep-alive connection leaves the Rust shell none the
 * wiser — both copies arrive complete and each is relayed as its own
 * remote-camera-photo event), so every delivery carries an id minted at send
 * time and the handlers claim it before processing: a repeat claim is the
 * same capture and must be dropped, or one snap stages two tray photos.
 *
 * Must be called synchronously at the top of the event handler, before any
 * await, and only by the listener that will actually process the photo (a
 * deferring listener returns early without claiming, or it would steal the
 * capture). Pure module — exercised by scripts/self-check-capture-dedupe.mjs.
 */

const CAPTURE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const seenCaptures = new Map<string, number>();

/** Claim a photo delivery: true = new capture (process it), false = repeat. */
export function claimRemoteCapture(
  captureId: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  // A page old enough to send no id has no dedupe key — process as before.
  if (!captureId) return true;
  for (const [id, at] of seenCaptures) {
    if (nowMs - at > CAPTURE_DEDUPE_TTL_MS) seenCaptures.delete(id);
  }
  if (seenCaptures.has(captureId)) return false;
  seenCaptures.set(captureId, nowMs);
  // ponytail: one entry per snap, pruned by TTL and capped at 200 — far past
  // any burst a review follow-up can produce; a ring buffer if this ever grows.
  if (seenCaptures.size > 200) {
    const oldest = seenCaptures.keys().next().value;
    if (oldest !== undefined) seenCaptures.delete(oldest);
  }
  return true;
}
