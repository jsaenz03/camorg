/**
 * PhoneCameraPanel Component
 *
 * Pairs a phone as the capture camera. The session is owned by the
 * CompanionProvider (like the sidebar's Phone link dialog): this panel
 * reuses a live session if there is one, otherwise asks the provider to
 * start it. The session deliberately outlives this screen — the sidebar
 * shows it and can end it — so the QR the phone scanned keeps working while
 * you move around the app. The photo arrives as a Tauri event and is
 * rebuilt into the same CapturedPhoto the built-in camera path produces, so
 * the save pipeline is unchanged.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setCaptureScreenActive, useCompanion } from '@/components/companion/companion-provider';
import type {
  CapturedPhoto,
  RemoteCameraPhotoEvent,
} from '@/specs/001-role-you-are/contracts/camera-service';

interface PhoneCameraPanelProps {
  onPhotoCaptured: (photo: CapturedPhoto) => void;
}

export function PhoneCameraPanel({ onPhotoCaptured }: PhoneCameraPanelProps) {
  const { active: sessionActive, url, phoneConnected, start } = useCompanion();
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Keep the latest callback without restarting the session on parent re-renders.
  const onPhotoCapturedRef = useRef(onPhotoCaptured);
  onPhotoCapturedRef.current = onPhotoCaptured;

  useEffect(() => {
    let cancelled = false;
    let unlistenPhoto: UnlistenFn | undefined;

    // The provider's global listener defers to the capture screen while the
    // panel is mounted, so a photo is never handled twice.
    setCaptureScreenActive(true);

    (async () => {
      try {
        unlistenPhoto = await listen<RemoteCameraPhotoEvent>(
          'remote-camera-photo',
          async (event) => {
            try {
              const { data } = event.payload;
              const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
              const blob = new Blob([bytes], { type: 'image/jpeg' });
              const bitmap = await createImageBitmap(blob);
              onPhotoCapturedRef.current({
                blob,
                dataUrl: `data:image/jpeg;base64,${data}`,
                width: bitmap.width,
                height: bitmap.height,
                capturedAt: new Date(),
              });
            } catch (error) {
              console.error('Failed to process photo from phone:', error);
              toast.error('Received the photo from your phone but could not read it. Try again.');
            }
          }
        );
        // One owner: if no Phone link is live, the provider starts (and from
        // then on tracks) the session; if one is, we just ride on it.
        if (!sessionActive) await start();
      } catch (error) {
        console.error('Failed to start phone camera link:', error);
        if (!cancelled) {
          setStartError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      setCaptureScreenActive(false);
      unlistenPhoto?.();
    };
  }, [attempt, sessionActive, start]);

  const handleCopyUrl = async () => {
    if (!url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Address copied');
    } catch {
      toast.error('Could not copy — type the address on your phone instead.');
    }
  };

  if (startError) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-destructive">Could not start the phone camera link.</p>
        <p className="text-xs text-muted-foreground">{startError}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setStartError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        {url ? (
          <div className="rounded-lg border bg-white p-3">
            <QRCodeSVG value={url} size={176} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-sm">Starting phone camera link…</p>
          </div>
        )}
      </div>

      {url && (
        <div className="space-y-2">
          {phoneConnected ? (
            <p className="text-sm text-center text-green-600 dark:text-green-400">
              Phone connected — take the photo on your phone.
            </p>
          ) : (
            <p className="text-sm text-center text-muted-foreground">
              Scan with your phone&rsquo;s camera (same Wi-Fi), or open:
            </p>
          )}
          {!phoneConnected && (
            <div className="flex items-center justify-center gap-1">
              <code className="font-mono text-xs break-all">{url}</code>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopyUrl}
                aria-label="Copy pairing address"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          )}
          <p className="text-xs text-center text-muted-foreground">
            If your phone can&rsquo;t connect, allow Camog through your computer&rsquo;s firewall.
          </p>
        </div>
      )}
    </div>
  );
}
