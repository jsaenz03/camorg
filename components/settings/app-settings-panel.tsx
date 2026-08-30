'use client';

/**
 * Admin: app settings. Toggles public signup, session timeout, org name.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ImagePlus, Loader2, RotateCcw, Trash2 } from 'lucide-react';

import type { AppSettings } from '@/types/invitation';
import {
  settingsUpdateSchema,
  type SettingsUpdate,
} from '@/lib/validators/schemas';
import { authService } from '@/lib/services/auth-service';
import { applyBrand, useBranding } from '@/components/branding-boot';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const TIMEOUT_OPTIONS = [
  { label: '15 minutes', ms: 15 * 60 * 1000 },
  { label: '30 minutes', ms: 30 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
];

const IDLE_LOCK_OPTIONS = [
  { label: 'Off', ms: 0 },
  { label: '1 minute', ms: 60 * 1000 },
  { label: '2 minutes', ms: 2 * 60 * 1000 },
  { label: '5 minutes', ms: 5 * 60 * 1000 },
  { label: '10 minutes', ms: 10 * 60 * 1000 },
  { label: '30 minutes', ms: 30 * 60 * 1000 },
];

/** Logo budget: shrunk to fit and capped so the settings row (read on every
 *  page load) stays light. ponytail: canvas re-encode only — a real asset
 *  pipeline would move this to Rust. */
const LOGO_MAX_DIM = 640;
const LOGO_MAX_DATA_URL = 400_000;
/** Placeholder for the unset colour picker — ≈ the built-in Camog teal. */
const BUILTIN_TEAL = '#007b82';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? resolve(img)
        : reject(new Error('no intrinsic size'));
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

/** Read an image file into a storable data URL, downscaling anything larger
 *  than needed. SVGs without an intrinsic size can't be rasterised and pass
 *  through as-is (still size-capped). */
async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file (PNG, JPG, WebP or SVG).');
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
  try {
    const img = await loadImage(raw);
    const scale = Math.min(1, LOGO_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale < 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
        if (out.length <= LOGO_MAX_DATA_URL) return out;
      }
    }
  } catch {
    // undecodable in canvas terms — fall through to the raw bytes
  }
  if (raw.length > LOGO_MAX_DATA_URL) {
    throw new Error('That image is too large — try one under about 300 KB.');
  }
  return raw;
}

export function AppSettingsPanel() {
  const [initial, setInitial] = useState<AppSettings | null>(null);
  const { refresh: refreshBranding } = useBranding();

  // Branding lives outside the react-hook-form: the colour pickers preview
  // live (applyBrand on every change) and the logo upload isn't a form field.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [brandPrimary, setBrandPrimary] = useState('');
  const [brandAccent, setBrandAccent] = useState('');

  const form = useForm<SettingsUpdate>({
    resolver: zodResolver(settingsUpdateSchema),
  });

  useEffect(() => {
    void authService
      .getSettings()
      .then((s) => {
        setInitial(s);
        setLogoUrl(s.logoDataUrl);
        setBrandPrimary(s.brandPrimary ?? '');
        setBrandAccent(s.brandAccent ?? '');
        form.reset({
          sessionTimeoutMs: s.sessionTimeoutMs,
          allowPublicSignup: s.allowPublicSignup,
          orgName: s.orgName,
          idleLockTimeoutMs: s.idleLockTimeoutMs,
          reviewWarningDays: s.reviewWarningDays,
          reviewStaleDays: s.reviewStaleDays,
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load settings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: SettingsUpdate) {
    try {
      const updated = await authService.updateSettings(values);
      setInitial(updated);
      form.reset({
        sessionTimeoutMs: updated.sessionTimeoutMs,
        allowPublicSignup: updated.allowPublicSignup,
        orgName: updated.orgName,
        idleLockTimeoutMs: updated.idleLockTimeoutMs,
        reviewWarningDays: updated.reviewWarningDays,
        reviewStaleDays: updated.reviewStaleDays,
      });
      refreshBranding();
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  }

  /** Persist the picked colours (and refresh app-wide branding). Fired on
   *  blur so dragging in the picker previews without a write per pixel. */
  async function commitBrand(p: string, a: string) {
    if (!initial) return;
    if (p === (initial.brandPrimary ?? '') && a === (initial.brandAccent ?? '')) return;
    try {
      const updated = await authService.updateSettings({
        brandPrimary: p || null,
        brandAccent: a || null,
      });
      setInitial(updated);
      refreshBranding();
      toast.success('Brand colours saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the colours.');
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      const updated = await authService.setLogo(dataUrl);
      setInitial(updated);
      setLogoUrl(dataUrl);
      refreshBranding();
      toast.success('Logo saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      const updated = await authService.setLogo(null);
      setInitial(updated);
      setLogoUrl(null);
      refreshBranding();
      toast.success('Logo removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  if (!initial) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle>App settings</CardTitle>
        <CardDescription>Organisation-wide configuration.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="orgName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organisation name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sessionTimeoutMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Session timeout</FormLabel>
                  <FormControl>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={field.value ?? initial.sessionTimeoutMs}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    >
                      {TIMEOUT_OPTIONS.map((o) => (
                        <option key={o.ms} value={o.ms}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>
                    Users are signed out after this period of inactivity. Each
                    user can choose their own timeout in Settings → Profile;
                    this is the organisation default.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="idleLockTimeoutMs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Idle privacy lock</FormLabel>
                  <FormControl>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={field.value ?? initial.idleLockTimeoutMs}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    >
                      {IDLE_LOCK_OPTIONS.map((o) => (
                        <option key={o.ms} value={o.ms}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>
                    After this period of inactivity the screen blurs and asks for the
                    passcode again — handy when patient data is visible in a clinic room.
                    The session itself stays signed in.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="allowPublicSignup"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel>Allow public sign up</FormLabel>
                    <FormDescription>
                      When on, anyone can request access; accounts stay pending
                      until approved in Users. When off, new users can only join
                      via an admin invite.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value ?? false}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="reviewWarningDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Review warning window (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const n = e.target.valueAsNumber;
                          field.onChange(Number.isFinite(n) ? n : undefined);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Reviews alert this many days before the due date.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reviewStaleDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stale patient window (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={7}
                        max={730}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const n = e.target.valueAsNumber;
                          field.onChange(Number.isFinite(n) ? n : undefined);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      A patient with photos but no review scheduled flags as
                      stale after this many quiet days.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Save
            </Button>
          </form>
        </Form>
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          <Link href="/legal" className="underline-offset-2 hover:underline">
            Terms of Service &amp; Privacy Policy
          </Link>
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Put the business&apos;s own mark on the app: a logo in the sidebar and on the
          sign-in screen, and brand colours on buttons and accents. Changes apply
          live — this page is the preview.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border p-1">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing for next/image to optimise
              <img src={logoUrl} alt="Business logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logo-file">Business logo</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={logoBusy}
                onClick={() => document.getElementById('logo-file')?.click()}
              >
                <ImagePlus className="size-4" aria-hidden /> {logoBusy ? 'Saving…' : 'Upload…'}
              </Button>
              {logoUrl && (
                <Button type="button" size="sm" variant="ghost" disabled={logoBusy} onClick={() => void removeLogo()}>
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              )}
            </div>
            <input
              id="logo-file"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void uploadLogo(f);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Shown in the sidebar and on the sign-in screen. PNG, JPG, WebP or SVG,
              shrunk to fit automatically.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="brand-primary">Primary — buttons, links, focus rings</Label>
            <input
              id="brand-primary"
              type="color"
              className="block h-10 w-16 cursor-pointer rounded-md border bg-background p-1"
              value={brandPrimary || BUILTIN_TEAL}
              onChange={(e) => {
                setBrandPrimary(e.target.value);
                applyBrand(e.target.value, brandAccent);
              }}
              onBlur={() => void commitBrand(brandPrimary, brandAccent)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="brand-accent">Accent — hover &amp; highlight tints</Label>
            <input
              id="brand-accent"
              type="color"
              className="block h-10 w-16 cursor-pointer rounded-md border bg-background p-1"
              value={brandAccent || BUILTIN_TEAL}
              onChange={(e) => {
                setBrandAccent(e.target.value);
                applyBrand(brandPrimary, e.target.value);
              }}
              onBlur={() => void commitBrand(brandPrimary, brandAccent)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!initial?.brandPrimary && !initial?.brandAccent}
            onClick={() => {
              setBrandPrimary('');
              setBrandAccent('');
              applyBrand(null, null);
              void commitBrand('', '');
            }}
          >
            <RotateCcw className="size-4" aria-hidden /> Reset to Camog default
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave a colour unset to keep the built-in Camog teal. Dark mode gets its own
          readable variant of each colour automatically.
        </p>
      </CardContent>
    </Card>
    </div>
  );
}
