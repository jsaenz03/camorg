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
import { setCaptureScreenActive, isCaptureScreenActive, companionService } from '@/lib/services/companion-service';
import { useCapture } from '@/components/capture/capture-provider';
import { auditService } from '@/lib/services/audit-service';
import { patientService } from '@/lib/services/patient-service';
import { storePendingPhoto, listPendingPhotos } from '@/lib/services/pending-photo-service';
import { remotePhotoToCapturedPhoto } from '@/lib/services/camera-service';
import type {
  CompanionPatientRequestEvent,
  RemoteCameraInfo,
  RemoteCameraPhotoEvent,
  RemoteCameraStatusEvent,
} from '@/specs/001-role-you-are/contracts/camera-service';

// A phone link left behind quietly keeps sharing the library, so the session
// ends itself after this long without any request from the phone.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const IDLE_POLL_MS = 60 * 1000;

interface CompanionContextValue {
  active: boolean;
  url: string | null;
  phoneConnected: boolean;
  shareLibrary: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setShareLibrary: (share: boolean) => Promise<void>;
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
  const [url, setUrl] = useState<string | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [shareLibrary, setShareLibraryState] = useState(true);

  // Latest-state refs for the long-lived event listeners.
  const stateRef = useRef({ active, shareLibrary });
  stateRef.current = { active, shareLibrary };

  const stop = useCallback(async () => {
    await invoke('stop_remote_camera').catch(() => {});
    await companionService.unpublish().catch(() => {});
    setActive(false);
    setUrl(null);
    setPhoneConnected(false);
    void auditService.record('companion.stop');
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
      setUrl(info.url);
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

  // Global listeners while the session is live. The capture screen's panel
  // handles camera photos when it is mounted; the phone's review/report
  // requests run the same desktop services the PC UI uses.
  useEffect(() => {
    if (!active) return;
    let unlistenPhoto: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;
    let unlistenReview: UnlistenFn | undefined;
    let unlistenReport: UnlistenFn | undefined;

    void (async () => {
      unlistenPhoto = await listen<RemoteCameraPhotoEvent>(
        'remote-camera-photo',
        async (event) => {
          if (isCaptureScreenActive()) return;
          try {
            const photo = await remotePhotoToCapturedPhoto(event.payload.data);
            await storePendingPhoto(photo);
            // Count the tray (not just this photo) so a burst of snaps reads
            // correctly in one toast.
            const waiting = (await listPendingPhotos().catch(() => [])).length;
            toast('Photo received from your phone', {
              description:
                waiting > 1
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
        },
      );
      unlistenStatus = await listen<RemoteCameraStatusEvent>('remote-camera-status', (event) => {
        setPhoneConnected(event.payload.connected);
      });
      unlistenReview = await listen<CompanionPatientRequestEvent>(
        'companion-review-request',
        async (event) => {
          const { patientId } = event.payload;
          try {
            await patientService.markReviewed(patientId);
            if (stateRef.current.shareLibrary) {
              await companionService.publish().catch(() => {});
            }
            toast.success('Patient marked as reviewed (from your phone).');
          } catch (error) {
            console.error('Phone review request failed:', error);
            toast.error(
              error instanceof Error ? error.message : 'Could not mark the patient reviewed.',
            );
          }
        },
      );
      unlistenReport = await listen<CompanionPatientRequestEvent>(
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
    })();

    return () => {
      unlistenPhoto?.();
      unlistenStatus?.();
      unlistenReview?.();
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

  // A webview reload wipes this React state while the Rust server (and the
  // phone's pairing) lives on. Re-adopt the session on mount so the status,
  // idle watchdog and photo-relay listeners come back instead of silently
  // dropping photos the phone sends.
  useEffect(() => {
    void invoke<RemoteCameraInfo | null>('remote_camera_active')
      .then((info) => {
        if (info) {
          setActive(true);
          setUrl(info.url);
        }
      })
      .catch(() => {});
  }, []);

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
      value={{ active, url, phoneConnected, shareLibrary, start, stop, setShareLibrary }}
    >
      {children}
    </CompanionContext.Provider>
  );
}

// Re-exported so the capture screen can flag itself active without reaching
// into the service module from two places with divergent intent.
export { setCaptureScreenActive };
