/**
 * Confirmation gate that actually works inside the Tauri webview.
 *
 * Tauri v2 patches window.confirm to route through the dialog plugin
 * asynchronously: it returns a promise — truthy even when rejected, and the
 * default capability set doesn't include dialog:allow-confirm — so every
 * `if (window.confirm(...))` guard silently passes and the destructive
 * action runs without asking. Always await this helper instead; in a plain
 * browser (tests, web export) it falls back to the native dialog.
 */

import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';

export async function confirmDialog(message: string): Promise<boolean> {
  const inTauri =
    typeof window !== 'undefined' &&
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
  if (inTauri) {
    return tauriConfirm(message, { title: 'Camog' });
  }
  return window.confirm(message);
}
