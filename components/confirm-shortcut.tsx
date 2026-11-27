'use client';

/**
 * Ctrl/Cmd+Enter commits the topmost open dialog — the keyboard equivalent of
 * its primary confirmation button (Save / Import / Move / Link / Activate…).
 *
 * The handler finds the last (topmost) open Radix dialog and drives its real
 * commit path: the body's <form> via requestSubmit(), which runs the same
 * submit handler and constraint validation as the dialog's own save button
 * (an invalid form stays open), else a button explicitly marked with
 * data-confirm-shortcut for button-driven dialogs that have no form. Dialogs
 * with no commit path (viewers, pickers, the command palette) no-op, and
 * plain Enter is untouched: single-line inputs submit natively and textareas
 * keep making newlines. Mounted once in the dashboard layout; the OS-native
 * confirmDialog (Tauri dialog plugin) renders outside the webview and is
 * unreachable by design. Pinned by tests/confirm-shortcut.spec.ts and
 * scripts/self-check-confirm-shortcut.mjs.
 */

import { useEffect } from 'react';

export function ConfirmShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.repeat || event.isComposing) {
        return;
      }
      // Portals append in mount order, so the last open dialog is the
      // topmost — a confirmDialog-style dialog stacked on another commits
      // the stacked one, never the one underneath.
      const open = document.querySelectorAll<HTMLElement>(
        '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]',
      );
      const dialog = open[open.length - 1];
      if (!dialog) return;
      const form = dialog.querySelector('form');
      if (form) {
        // Gate on the dialog's own primary submitter: a disabled save button
        // (isSaving spinners, typed-CLEAR destructive confirms) means
        // Ctrl+Enter does nothing, exactly like pressing the dead button.
        // Submitters may sit outside the <form> element associated via the
        // form attribute (photo-detail's "Save changes"), so fall back to
        // that, then to the form's implicit default button.
        const submitter =
          form.querySelector<HTMLInputElement | HTMLButtonElement>('button[type="submit"],input[type="submit"]') ??
          (form.id ? document.querySelector<HTMLButtonElement>(`button[form="${form.id}"]`) : null) ??
          form.querySelector<HTMLButtonElement>('button:not([type="button"]):not([type="reset"])');
        if (submitter?.disabled) return;
        // Consume the event: our capture listener runs before everything
        // else, and a stopPropagation here keeps per-field Enter handlers
        // (licence key textarea) from firing a second submit behind us.
        event.preventDefault();
        event.stopPropagation();
        form.requestSubmit();
        return;
      }
      const marked = dialog.querySelector<HTMLButtonElement>('[data-confirm-shortcut]:not(:disabled)');
      if (marked) {
        event.preventDefault();
        event.stopPropagation();
        marked.click();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return null;
}
