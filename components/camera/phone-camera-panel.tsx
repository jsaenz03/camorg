/**
 * PhoneCameraPanel Component
 *
 * Pairs a phone as the capture camera. Starts the LAN tether server in the
 * Rust shell, shows the pairing URL as a QR code, and listens for the photo
 * the phone sends back. The photo is rebuilt into the same CapturedPhoto the
 * built-in camera path produces, so the save pipeline is unchanged.
 *
 * Server lifecycle is tied to this component's mount: navigating away or
 * capturing a photo unmounts the capture screen and stops the server.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type {
  CapturedPhoto,
  RemoteCameraInfo,
  RemoteCameraPhotoEvent,
  RemoteCameraStatusEvent,
} from '@/specs/001-role-you-are/contracts/camera-service';

interface PhoneCameraPanelProps {
  onPhotoCaptured: (photo: CapturedPhoto) => void;
}

export function PhoneCameraPanel({ onPhotoCaptured }: PhoneCameraPanelProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Keep the latest callback without restarting the server on parent re-renders.
  const onPhotoCapturedRef = useRef(onPhotoCaptured);
  onPhotoCapturedRef.current = onPhotoCaptured;

  useEffect(() => {
    let cancelled = false;
    let unlistenPhoto: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

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
        unlistenStatus = await listen<RemoteCameraStatusEvent>(
          'remote-camera-status',
          (event) => {
            // hello → true, bye (pagehide beacon) → false.
            setPhoneConnected(event.payload.connected);
          }
        );
        const info = await invoke<RemoteCameraInfo>('start_remote_camera');
        if (!cancelled) {
          setUrl(info.url);
        }
      } catch (error) {
        console.error('Failed to start phone camera link:', error);
        if (!cancelled) {
          setStartError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      unlistenPhoto?.();
      unlistenStatus?.();
      void invoke('stop_remote_camera').catch(() => {});
    };
  }, [attempt]);

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
