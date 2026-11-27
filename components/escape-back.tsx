'use client';

/**
 * Escape steps back up the screen hierarchy when nothing is open.
 *
 * Modals already step back via Radix (Escape closes the topmost dialog);
 * this adds the page layer on top of that: report → patient → patient list →
 * dashboard, mirroring the destinations the pages' own back buttons use
 * (patient view's "Back to patients", the report's "Back to timeline"). A
 * static parent map, not history.back(): navigation stays predictable no
 * matter how the screen was reached, and agrees with the visible affordance.
 *
 * Escape is claimed with preventDefault, and this handler never claims one
 * synchronously — its capture listener only runs the guards below, then
 * defers the navigation one macrotask and navigates solely if no page-level
 * owner claimed the event meanwhile. That is what makes Escape peel layers:
 * band cancel (photo-bento) → selection clear (photos page / photo timeline)
 * → step back. Fullscreen owners that replace the Radix dialog entirely
 * (the photo annotator) mark themselves with data-escape-owner so Escape
 * does nothing underneath them. Focus inside a text field also opts out —
 * Escape while typing is the user's own — and the dashboard and Settings
 * are top-level: Escape does nothing there.
 *
 * Mounted once in the dashboard layout. Pinned by tests/escape-back.spec.ts
 * and scripts/self-check-escape-back.mjs.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function parentOf(pathname: string, search: string): string | null {
  // next.config sets trailingSlash: true — the address bar carries a trailing
  // slash on every section route, so match against the normalized form.
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (path === '/patients/report') {
    const id = new URLSearchParams(search).get('id');
    return id ? `/patients/view?id=${encodeURIComponent(id)}` : '/patients';
  }
  if (path === '/patients/view') return '/patients';
  if (path === '/patients' || path === '/photos' || path === '/compare') return '/';
  return null; // dashboard, settings, anything unmapped: Escape stays free
}

export function EscapeBack() {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing
      ) {
        return;
      }
      if (event.defaultPrevented) return; // an earlier listener already claimed it
      // Radix owns Escape while any overlay is up. Radix dialogs close on
      // Escape; the idle-lock overlay is a bare portal div (role=dialog but
      // no data-state) that only unlock ends — it owns Escape outright;
      // poppers, menus and select panels close one layer at a time; and
      // data-escape-owner screens own it outright too. Stepping back
      // underneath any of them on the same keypress would be a double
      // action, so hands off until the screen is clean.
      const overlayOpen = (selector: string) => document.querySelector(selector) !== null;
      if (
        overlayOpen('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]') ||
        overlayOpen('[data-idle-lock-overlay]') ||
        overlayOpen('[data-radix-popper-content-wrapper],[role="menu"],[role="listbox"]') ||
        overlayOpen('[data-escape-owner]')
      ) {
        return;
      }
      // Never navigate out from under typing.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      const parent = parentOf(window.location.pathname, window.location.search);
      if (!parent) return;
      // The guards passed, but this dispatch isn't over: page-level Escape
      // owners (selection clears, the bento band) registered later run after
      // this capture listener and claim the event with preventDefault.
      // Navigate one macrotask later, only if it is still unclaimed.
      setTimeout(() => {
        if (event.defaultPrevented) return;
        router.push(parent);
      }, 0);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [router]);

  return null;
}
