/**
 * Companion Provider
 *
 * Owns the phone link session at app level: starts/stops the tether server,
 * publishes the shared library, tracks phone connectivity, and catches photos
 * the phone sends while the capture screen is not mounted — they are staged
 * in the pending-photos tray (pending-photo-service) with a toast, so a
 * mid-consult snap is never lost.
 *
 * Mounted once in the dashboard layout; the sidebar entry and the Phone link
 * dialog both consume this context. Ending the session (or unmounting, e.g.
 * sign-out) always stops the server and unpublishes the library.
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import {
  setCaptureScreenActive,
  isCaptureScreenActive,
  companionService,
  armReviewFollowUp,
  clearReviewFollowUp,
  consumeReviewFollowUp,
} from '@/lib/services/companion-service';
import { claimRemoteCapture } from '@/lib/utils/capture-dedupe';
import { ATTENTION_CHANGED_EVENT } from '@/lib/services/attention-events';
import { useCapture } from '@/components/capture/capture-provider';
import { auditService } from '@/lib/services/audit-service';
import { photoService } from '@/lib/services/photo-service';
import { storePendingPhoto, listPendingPhotos } from '@/lib/services/pending-photo-service';
import { remotePhotoToCapturedPhoto } from '@/lib/services/camera-service';
import type {
  CompanionPatientRequestEvent,
  CompanionPhotoReviewRequestEvent,
  RemoteCameraInfo,
  RemoteCameraUrl,
  RemoteCameraPhotoEvent,
  RemoteCameraStatusEvent,
} from '@/specs/001-role-you-are/contracts/camera-service';

// A phone link left behind quietly keeps sharing the library, so the session
// ends itself after this long without any request from the phone.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const IDLE_POLL_MS = 60 * 1000;

interface CompanionContextValue {
  active: boolean;
  /** Every live pairing URL, same-network primary first. */
  urls: RemoteCameraUrl[];
  /** The primary pairing URL (the same-network one) — what a single-QR surface shows. */
  url: string | null;
  phoneConnected: boolean;
  shareLibrary: boolean;
  /** "Start automatically": the link starts itself when the app opens. */
  remember: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Rotate the pairing code: the old QR (and any phone holding it) stops
   * working immediately; the link stays up on the same address with a new
   * code for re-scanning. For when the code was shared or photographed. */
  regenerate: () => Promise<void>;
  /** Re-read the live pairing URLs — call when a surface opens, so a network
   * change (Wi-Fi ↔ hotspot) is reflected without restarting the link. */
  refresh: () => Promise<void>;
  setShareLibrary: (share: boolean) => Promise<void>;
  setRemember: (remember: boolean) => Promise<void>;
}

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function useCompanion(): CompanionContextValue {
  const ctx = useContext(CompanionContext);
  if (!ctx) throw new Error('useCompanion must be used within CompanionProvider');
  return ctx;
}

export function CompanionProvider({ children }: { children: ReactNode }) {
  const { openCapture } = useCapture();
  const [active, setActive] = useState(false);
  const [urls, setUrls] = useState<RemoteCameraUrl[]>([]);
  const url = urls[0]?.url ?? null;
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [shareLibrary, setShareLibraryState] = useState(true);
  const [remember, setRememberState] = useState(true);

  // Latest-state refs for the long-lived event listeners.
  const stateRef = useRef({ active, shareLibrary });
  stateRef.current = { active, shareLibrary };

  const stop = useCallback(async () => {
    await invoke('stop_remote_camera').catch(() => {});
    await companionService.unpublish().catch(() => {});
    setActive(false);
    setUrls([]);
    setPhoneConnected(false);
    void auditService.record('companion.stop');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const info = await invoke<RemoteCameraInfo | null>('remote_camera_active');
      if (info) {
        setActive(true);
        setUrls(info.urls);
      } else {
        setActive(false);
        setUrls([]);
        setPhoneConnected(false);
      }
    } catch {
      /* the link is simply not available (e.g. dev server without Tauri) */
    }
  }, []);

  const start = useCallback(async () => {
    // Share the library first so the phone sees it the moment it pairs; a
    // failure here degrades to capture-only rather than blocking the link.
    if (stateRef.current.shareLibrary) {
      await companionService
        .publish()
        .catch(() => toast.error('Could not share the photo library with your phone.', {
          description: 'The link will still work for taking photos.',
        }));
    }
    try {
      // Adopt a server that is already running rather than restarting it —
      // a restart would mint a new token and silently kill the QR the phone
      // may already have open (capture-screen pairing, or a webview reload
      // that wiped this React state while the Rust server lived on).
      const existing = await invoke<RemoteCameraInfo | null>('remote_camera_active');
      const info = existing ?? (await invoke<RemoteCameraInfo>('start_remote_camera'));
      setActive(true);
      setUrls(info.urls);
      setPhoneConnected(false);
      void auditService.record('companion.start', {
        detail: stateRef.current.shareLibrary ? 'with photo library' : 'camera only',
      });
    } catch (error) {
      console.error('Failed to start phone link:', error);
      toast.error('Could not start the phone link.', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const regenerate = useCallback(async () => {
    try {
      // The Rust side stops the server, deletes the persisted token and
      // starts again on the same pinned port; the shared library survives
      // the restart, so a re-paired phone needs nothing else.
      const info = await invoke<RemoteCameraInfo>('reset_pairing_token');
      setActive(true);
      setUrls(info.urls);
      setPhoneConnected(false);
      void auditService.record('companion.new_code');
      toast.info('New pairing code ready', {
        description: 'The previous code no longer works — scan the new one when you next pair.',
      });
    } catch (error) {
      console.error('Failed to rotate the pairing code:', error);
      toast.error('Could not generate a new code.', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const setShareLibrary = useCallback(async (share: boolean) => {
    setShareLibraryState(share);
    if (!stateRef.current.active) return;
    if (share) {
      await companionService.publish().catch(() =>
        toast.error('Could not share the photo library with your phone.'),
      );
    } else {
      await companionService.unpublish().catch(() => {});
    }
  }, []);

  const setRemember = useCallback(async (value: boolean) => {
    setRememberState(value);
    await invoke('set_phone_link_remember', { remember: value }).catch(() => {});
    // Turning remember on with no live link starts one right away, so the
    // toggle takes effect without waiting for the next app launch.
    if (value && !stateRef.current.active) {
      await start();
    }
  }, [start]);

  // Global listeners while the session is live. The capture screen's panel
  // handles camera photos when it is mounted; the phone's review/report
  // requests run the same desktop services the PC UI uses.
  useEffect(() => {
    if (!active) return;
    let unlistenPhoto: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;
    let unlistenPhotoReview: UnlistenFn | undefined;
    let unlistenReport: UnlistenFn | undefined;
    // A listen that resolves after this effect has been torn down (a fast
    // stop/unmount, or dev StrictMode's mount-cleanup-mount) would otherwise
    // leak and double-handle every later photo.
    let disposed = false;

    void (async () => {
      const photo = await listen<RemoteCameraPhotoEvent>('remote-camera-photo', async (event) => {
        if (isCaptureScreenActive()) return;
        // Same-event dedupe (claim before any await so a leaked duplicate
        // listener always loses the race): must not run before the deferral
        // guard above, or the capture screen's own handler would see the
        // capture as a repeat and drop it.
        if (!claimRemoteCapture(event.payload.captureId)) return;
        try {
          const photo = await remotePhotoToCapturedPhoto(event.payload.data);
          // A "Snap photo" review follow-up: this snap joins the reviewed
          // photo's lesion series when it is saved from the tray. A
          // patient-tagged snap (the phone's Take photo on a patient screen)
          // carries that patient so the save prefills their details.
          const linkPhotoId = consumeReviewFollowUp();
          await storePendingPhoto(
            photo,
            linkPhotoId ?? undefined,
            event.payload.patientId ?? undefined,
          );
          // Count the tray (not just this photo) so a burst of snaps reads
          // correctly in one toast.
          const waiting = (await listPendingPhotos().catch(() => [])).length;
          toast('Photo received from your phone', {
            description: linkPhotoId
              ? 'Review follow-up — saving it links it into the reviewed photo’s series.'
              : waiting > 1
                ? `${waiting} photos are waiting in Capture for review.`
                : 'Open Capture to review and save it.',
            action: {
              label: 'Review',
              onClick: () => openCapture(),
            },
          });
        } catch (error) {
          console.error('Failed to process photo from phone:', error);
          toast.error('Received the photo from your phone but could not read it. Try again.');
        }
      });
      if (disposed) {
        photo();
        return;
      }
      unlistenPhoto = photo;
      const status = await listen<RemoteCameraStatusEvent>('remote-camera-status', (event) => {
        setPhoneConnected(event.payload.connected);
      });
      if (disposed) {
        status();
        return;
      }
      unlistenStatus = status;
      const photoReview = await listen<CompanionPhotoReviewRequestEvent>(
        'companion-photo-review-request',
        async (event) => {
          const { photoId, snap } = event.payload;
          // Arm before anything slow: the phone flips to its camera the
          // moment the shell answers, so the follow-up snap can arrive a
          // second later — never make it race the review bookkeeping.
          if (snap) armReviewFollowUp(photoId);
          try {
            // The same service the desktop photo dialog runs: stamps the
            // photo's review AND counts as the patient's review.
            await photoService.reviewPhoto(photoId);
            if (stateRef.current.shareLibrary) {
              await companionService.publish().catch(() => {});
            }
            toast.success('Photo marked as reviewed (from your phone).');
          } catch (error) {
            if (snap) clearReviewFollowUp();
            console.error('Phone photo review request failed:', error);
            toast.error(
              error instanceof Error ? error.message : 'Could not mark the photo reviewed.',
            );
          }
        },
      );
      if (disposed) {
        photoReview();
        return;
      }
      unlistenPhotoReview = photoReview;
      const report = await listen<CompanionPatientRequestEvent>(
        'companion-report-request',
        async (event) => {
          const { patientId } = event.payload;
          try {
            await companionService.generateReport(patientId);
          } catch (error) {
            console.error('Phone report request failed:', error);
            toast.error(
              error instanceof Error ? error.message : 'Could not prepare the case report.',
            );
          }
        },
      );
      if (disposed) {
        report();
        return;
      }
      unlistenReport = report;
    })();

    return () => {
      disposed = true;
      unlistenPhoto?.();
      unlistenStatus?.();
      unlistenPhotoReview?.();
      unlistenReport?.();
    };
  }, [active, openCapture]);

  // Auto-end: if the phone has gone quiet for IDLE_LIMIT_MS, close the link
  // so the library is not shared to a phone left at home.
  useEffect(() => {
    if (!active) return;
    const poll = setInterval(() => {
      void invoke<number | null>('remote_camera_idle_ms').then((idleMs) => {
        if (idleMs != null && idleMs > IDLE_LIMIT_MS) {
          void stop();
          toast.info('Phone link closed', {
            description: 'It was idle for more than 30 minutes. Start it again from the sidebar.',
          });
        }
      }).catch(() => {});
    }, IDLE_POLL_MS);
    return () => clearInterval(poll);
  }, [active, stop]);

  // Desktop-side edits (metadata, reviews) while the session is open refresh
  // the manifest the next time the window regains focus.
  useEffect(() => {
    if (!active || !shareLibrary) return;
    const onFocus = () => {
      if (stateRef.current.active && stateRef.current.shareLibrary) {
        void companionService.publish().catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active, shareLibrary]);

  // Bilateral sync, desktop half: every count-affecting mutation (review
  // stamps, rescheduled reviews, photo saves) fires the attention event, so
  // republish the manifest the instant it lands. The phone's held long-poll
  // (library-wait) wakes on the publish and refetches — updates arrive on
  // the action that caused them, the same way the phone's snaps arrive here.
  useEffect(() => {
    if (!active || !shareLibrary) return;
    const onAttention = () => {
      if (stateRef.current.active && stateRef.current.shareLibrary) {
        void companionService.publish().catch(() => {});
      }
    };
    window.addEventListener(ATTENTION_CHANGED_EVENT, onAttention);
    return () => window.removeEventListener(ATTENTION_CHANGED_EVENT, onAttention);
  }, [active, shareLibrary]);

  // A webview reload wipes this React state while the Rust server (and the
  // phone's pairing) lives on. Re-adopt the session on mount so the status,
  // idle watchdog and photo-relay listeners come back instead of silently
  // dropping photos the phone sends. With no server running and "start
  // automatically" on, start the link: the pairing URL is persisted in the
  // app data dir, so the phone's saved home-screen icon keeps working after
  // an app restart without re-scanning the QR.
  useEffect(() => {
    void (async () => {
      const remembered = await invoke<boolean>('get_phone_link_remember')
        .then((value) => {
          setRememberState(value);
          return value;
        })
        .catch(() => true);
      try {
        const existing = await invoke<RemoteCameraInfo | null>('remote_camera_active');
        if (existing) {
          setActive(true);
          setUrls(existing.urls);
        } else if (remembered) {
          await start();
        }
      } catch {
        /* the link is simply not available (e.g. dev server without Tauri) */
      }
    })();
  }, [start]);

  // Leaving the dashboard (sign-out) ends the session.
  useEffect(() => {
    return () => {
      if (stateRef.current.active) {
        void stop();
      }
    };
  }, [stop]);

  return (
    <CompanionContext.Provider
      value={{
        active,
        urls,
        url,
        phoneConnected,
        shareLibrary,
        remember,
        start,
        stop,
        regenerate,
        refresh,
        setShareLibrary,
        setRemember,
      }}
    >
      {children}
    </CompanionContext.Provider>
  );
}

// Re-exported so the capture screen can flag itself active without reaching
// into the service module from two places with divergent intent.
export { setCaptureScreenActive };
