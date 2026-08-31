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

export interface CaptureOptions {
  /** Prefill the patient fields (capture-for-patient from their timeline). */
  patientName?: string;
  patientDob?: string;
  /** Called with the patient id after a successful save; skips the timeline navigation. */
  onSaved?: (patientId: string) => void;
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
  const { patientName, patientDob, onSaved } = host.optionsRef.current;
  return (
    <CaptureDialog
      open={host.open}
      onOpenChange={host.onOpenChange}
      patientName={patientName}
      patientDob={patientDob}
      onSaved={onSaved}
    />
  );
}
