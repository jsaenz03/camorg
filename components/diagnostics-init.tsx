'use client';

/**
 * Mounts the global diagnostics capture hooks (window errors, unhandled
 * rejections, console + toast wrappers). Initialises at module evaluation —
 * earlier than any useEffect — so a crash during the very first render is
 * still caught via the ErrorBoundary's console.error. SSR-safe (no-op on the
 * server). Renders nothing.
 */

import { initDiagnostics } from '@/lib/diagnostics';

initDiagnostics();

export function DiagnosticsInit() {
  return null;
}
