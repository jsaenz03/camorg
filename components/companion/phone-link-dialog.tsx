/**
 * PhoneLinkDialog
 *
 * Desktop control surface for the phone companion session: pair via QR,
 * choose whether the phone may browse the shared library, and end the
 * session. Session state lives in CompanionProvider so the link survives
 * closing this dialog and navigation between pages.
 */

'use client';

import { useState } from 'react';
import { Loader2, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCompanion } from '@/components/companion/companion-provider';

export function PhoneLinkDialog({ children }: { children: React.ReactNode }) {
  const {
    active,
    urls,
    url,
    phoneConnected,
    shareLibrary,
    remember,
    start,
    stop,
    refresh,
    setShareLibrary,
    setRemember,
  } = useCompanion();
  const [starting, setStarting] = useState(false);
  // The primary QR already covers a tunnel-only link (no ordinary network).
  const tailscaleUrls = urls.filter((u) => u.kind === 'tailscale' && u.url !== url);

  const handleStart = async () => {
    setStarting(true);
    await start();
    setStarting(false);
  };

  const handleCopy = async (address: string | null) => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      toast.error('Could not copy — type the address on your phone instead.');
    }
  };

  return (
    <Dialog onOpenChange={(open) => { if (open && active) void refresh(); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-5" />
            Phone link
          </DialogTitle>
          <DialogDescription>
            Use your phone to take photos and review the library with your
            patient, anywhere in the room.
          </DialogDescription>
        </DialogHeader>

        {!active ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan the code with your phone (same Wi-Fi) and it becomes a
              second screen for Camog: a capture camera and a pocket view of
              every patient and photo you can open on this computer.
            </p>
            <Button onClick={handleStart} disabled={starting} className="w-full">
              {starting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Starting…
                </>
              ) : (
                'Start phone link'
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              {url && (
                <div className="rounded-lg border bg-white p-3">
                  <QRCodeSVG value={url} size={160} />
                </div>
              )}
            </div>

            <p className="text-sm text-center" aria-live="polite">
              {phoneConnected ? (
                <span className="text-green-600 dark:text-green-400">
                  Phone connected.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Scan with your phone&rsquo;s camera, or{' '}
                      <button
                        type="button"
                        onClick={() => void handleCopy(url)}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        copy the address
                      </button>
                      .
                    </span>
              )}
            </p>

            {tailscaleUrls.length > 0 && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Away from this Wi-Fi (Tailscale)</p>
                  <p className="text-xs text-muted-foreground">
                    Pairs from anywhere — both this computer and your phone
                    need the Tailscale app signed in to the same network.
                  </p>
                </div>
                {tailscaleUrls.map((u) => (
                  <div key={u.url} className="flex items-center gap-3">
                    <div className="shrink-0 rounded-md bg-white p-1.5">
                      <QRCodeSVG value={u.url} size={72} />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy(u.url)}
                      className="text-left font-mono text-xs break-all underline underline-offset-2 hover:text-foreground"
                    >
                      {u.url}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="remember-link" className="text-sm font-medium">
                  Start automatically
                </Label>
                <p className="text-xs text-muted-foreground">
                  The link starts itself whenever Camog opens, with the same
                  address — your phone&rsquo;s saved home-screen icon works
                  without re-scanning the code.
                </p>
              </div>
              <Switch
                id="remember-link"
                checked={remember}
                onCheckedChange={(v) => void setRemember(v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="share-library" className="text-sm font-medium">
                  Share photo library
                </Label>
                <p className="text-xs text-muted-foreground">
                  The phone can browse the same patients and photos you can,
                  mark reviews, and get case reports.
                </p>
              </div>
              <Switch
                id="share-library"
                checked={shareLibrary}
                onCheckedChange={(v) => void setShareLibrary(v)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Anyone with this code — on the same Wi-Fi or hotspot, or in your
              Tailscale network — can take photos and open the shared library
              until you end the session. The link itself is not encrypted (a
              Tailscale address is, by the tunnel), so end it when
              you&rsquo;re done. It closes itself after 30 minutes of
              inactivity, and with Start automatically on it reopens (same
              address) next time Camog starts.
            </p>

            <Button variant="destructive" className="w-full" onClick={() => void stop()}>
              End session
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

