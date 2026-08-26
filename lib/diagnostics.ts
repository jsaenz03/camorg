/**
 * Frontend diagnostics capture.
 *
 * Every failure avenue in the webview funnels into recordDiagnostic(), which
 * forwards to the Rust ring buffer (Settings → Diagnostics) and the camog.log
 * file:
 * - uncaught exceptions (`window` error event)
 * - unhandled promise rejections
 * - every existing console.error / console.warn call site (camera, photo
 *   save, login, audit, …) via a pass-through console wrapper
 * - every user-facing failure toast via a sonner toast.error wrapper
 *
 * ponytail: wrapping console + toast.error is monkey-patching, not an API —
 * if sonner ever freezes the toast object this silently degrades to the
 * console path. Upgrade path: a this.app.runError(fn) helper at call sites.
 */

import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

export type DiagnosticLevel = 'error' | 'warn' | 'info';

export interface DiagnosticEntry {
  ts: number;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  detail: string | null;
}

export interface DiagnosticsInfo {
  version: string;
  os: string;
  logDir: string | null;
  entries: DiagnosticEntry[];
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

let lastKey = '';
let lastAt = 0;

/**
 * Record a diagnostic event. Never throws and never blocks the caller —
 * outside the Tauri webview (plain `npm run dev` in a browser) the invoke
 * rejects and is swallowed.
 */
export function recordDiagnostic(
  level: DiagnosticLevel,
  source: string,
  message: string,
  detail?: string,
): void {
  try {
    const now = Date.now();
    // console.error + toast.error often fire for the same failure; skip an
    // identical record made within the last two seconds.
    const key = `${level}|${source}|${message}`;
    if (key === lastKey && now - lastAt < 2000) return;
    lastKey = key;
    lastAt = now;
    void invoke('record_web_diagnostic', {
      level,
      source,
      message,
      detail: detail ?? null,
    }).catch(() => {});
  } catch {
    // Diagnostics must never break the app it is observing.
  }
}

let initialised = false;

/** Installs the global capture hooks. Idempotent; client-side only. */
export function initDiagnostics(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  window.addEventListener('error', (event) => {
    // Resource-load failures arrive as plain Events with no message.
    if (!(event instanceof ErrorEvent) || !event.message) return;
    const where = event.filename
      ? `${event.filename}:${event.lineno}:${event.colno}`
      : undefined;
    recordDiagnostic('error', 'window', event.message, where);
  });

  window.addEventListener('unhandledrejection', (event) => {
    recordDiagnostic('error', 'promise', stringify(event.reason));
  });

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const rest = args.slice(1).map(stringify).join('\n');
    recordDiagnostic('error', 'console', stringify(args[0]), rest || undefined);
    originalError(...args);
  };

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const rest = args.slice(1).map(stringify).join('\n');
    recordDiagnostic('warn', 'console', stringify(args[0]), rest || undefined);
    originalWarn(...args);
  };

  // Service failures that only surface as a toast (no console.error at the
  // catch site) are the last big avenue; sonner's toast object is a plain
  // mutable object, so patching its error method captures them all.
  const originalToastError = toast.error;
  toast.error = (message, data) => {
    recordDiagnostic('error', 'ui', stringify(message));
    return originalToastError(message, data);
  };
}
