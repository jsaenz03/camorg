/**
 * Capture Provider
 *
 * Opens the capture dialog over whatever page you are on — the sidebar,
 * dashboard, photos page, and a patient's timeline all call openCapture()
 * instead of navigating to a capture route (there is none). Options carry
 * the capture-for-patient prefill and an onSaved hook so the caller stays
 * in place after the photo lands.
 *
 * Provider order matters: this sits ABOVE CompanionProvider (whose toast
 * opens capture), so the dialog itself is rendered by <CaptureHost />, which
 * the layout mounts inside the CompanionProvider tree — the phone pairing
 * panel consumes that context.
 */

'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CaptureDialog } from '@/components/capture/capture-dialog';
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart, BodyView, Laterality, PinpointSpace } from '@/types/body-part';

/** Location metadata a review follow-up inherits from its original photo. */
export interface CapturePrefill {
  bodyPart: BodyPart;
  laterality?: Laterality;
  subpart?: string;
  pinX?: number;
  pinY?: number;
  pinSpace?: PinpointSpace;
  pinView?: BodyView;
}

export interface CaptureOptions {
  /** Prefill the patient fields (capture-for-patient from their timeline). */
  patientName?: string;
  patientDob?: string;
  /**
   * Review follow-up: after save, join this photo's lesion series (or start
   * one anchored to it) so the new photo links to the original.
   */
  linkPhotoId?: string;
  /** Prefill the metadata form — a review follow-up inherits the original's location. */
  prefill?: CapturePrefill;
  /** Called with the patient id after a successful save; skips the timeline navigation. */
  onSaved?: (patientId: string) => void;
}

/**
 * Capture options for a review follow-up: prefills the patient fields and
 * the original photo's location metadata (body part, side, subpart,
 * pinpoint), and links the saved photo to the original's lesion series.
 */
export function reviewFollowUpCapture(
  photo: PhotoRecord,
  context: {
    patientName?: string;
    patientDob?: string;
    onSaved?: (patientId: string) => void;
  },
): CaptureOptions {
  return {
    ...context,
    linkPhotoId: photo.id,
    prefill: {
      bodyPart: photo.bodyPart,
      laterality: photo.laterality ?? undefined,
      subpart: photo.subpart ?? '',
      pinX: photo.pinX ?? undefined,
      pinY: photo.pinY ?? undefined,
      pinSpace: photo.pinSpace ?? undefined,
      pinView: photo.pinView ?? undefined,
    },
  };
}

interface CaptureContextValue {
  openCapture: (options?: CaptureOptions) => void;
}

const CaptureContext = createContext<CaptureContextValue | null>(null);

/** Internal: everything CaptureHost needs to render the dialog. */
const CaptureHostContext = createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  optionsRef: { current: CaptureOptions };
} | null>(null);

export function useCapture(): CaptureContextValue {
  const ctx = useContext(CaptureContext);
  if (!ctx) throw new Error('useCapture must be used within CaptureProvider');
  return ctx;
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Latest options for the host; every openCapture call replaces them, so a
  // general open (sidebar) never inherits a previous patient's prefill.
  const optionsRef = useRef<CaptureOptions>({});

  const openCapture = useCallback((options: CaptureOptions = {}) => {
    optionsRef.current = options;
    setOpen(true);
  }, []);

  return (
    <CaptureHostContext.Provider value={{ open, onOpenChange: setOpen, optionsRef }}>
      <CaptureContext.Provider value={{ openCapture }}>{children}</CaptureContext.Provider>
    </CaptureHostContext.Provider>
  );
}

/**
 * Renders the dialog. The layout mounts it inside the CompanionProvider tree
 * (the phone pairing panel consumes that context); its dialog state comes
 * from the CaptureHostContext above.
 */
export function CaptureHost() {
  const host = useContext(CaptureHostContext);
  if (!host) throw new Error('CaptureHost must be used within CaptureProvider');
  const { patientName, patientDob, linkPhotoId, prefill, onSaved } = host.optionsRef.current;
  return (
    <CaptureDialog
      open={host.open}
      onOpenChange={host.onOpenChange}
      patientName={patientName}
      patientDob={patientDob}
      linkPhotoId={linkPhotoId}
      prefill={prefill}
      onSaved={onSaved}
    />
  );
}
