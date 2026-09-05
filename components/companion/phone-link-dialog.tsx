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
    regenerate,
    refresh,
    setShareLibrary,
    setRemember,
  } = useCompanion();
  const [starting, setStarting] = useState(false);
  const [rotating, setRotating] = useState(false);
  // The primary QR already covers a tunnel-only link (no ordinary network).
  const tailscaleUrls = urls.filter((u) => u.kind === 'tailscale' && u.url !== url);

  const handleStart = async () => {
    setStarting(true);
    await start();
    setStarting(false);
  };

  const handleNewCode = async () => {
    setRotating(true);
    await regenerate();
    setRotating(false);
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
      {/* Landscape-first: the pairing surface and the session controls sit
          side by side on wide screens (the dialog is the surface that
          matters, so sm: tracks its width tier), stacking back to one
          column on narrow ones; the whole content scrolls on short
          viewports the same way the capture dialog does. */}
      <DialogContent className="max-h-[95dvh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader className="pr-8">
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
          <>
            {/* Fixed QR track: an auto track would size to the status
                paragraph's max-content width and starve the controls
                column. 190px = the 160px QR card plus its padding/border. */}
            <div className="grid gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
              {/* Pairing surface: the QR and its live status, centred in its
                  column so it reads as one block next to the controls. */}
              <div className="flex flex-col items-center justify-center gap-3">
                {url && (
                  <div className="rounded-lg border bg-white p-3">
                    <QRCodeSVG value={url} size={160} />
                  </div>
                )}

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
              </div>

              {/* Session controls. */}
              <div className="space-y-3">
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
                  you&rsquo;re done — ending it also signs paired phones out, and
                  they re-scan to reconnect. It closes itself after 30 minutes of
                  inactivity, and with Start automatically on it reopens (same
                  address) next time Camog starts. If the code was shared or
                  photographed, generate a new one — the old code stops working
                  straight away.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleNewCode}
                disabled={rotating}
              >
                {rotating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    New code…
                  </>
                ) : (
                  'New code'
                )}
              </Button>
              <Button variant="destructive" className="flex-1" onClick={() => void stop()}>
                End session
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

