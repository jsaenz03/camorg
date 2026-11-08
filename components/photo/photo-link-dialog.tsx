/**
 * PhotoLinkDialog
 *
 * Confirmation for drag-to-link and drag-to-unlink. Dropping photo tile(s)
 * onto another opens this with the thumbnails:
 *  - different series (or either photo unlinked): the resolved series name is
 *    editable, with the patient's existing series as chips — the same
 *    vocabulary as the detail dialog's series field;
 *  - same series: the drop unlinks the dragged photo instead — the dialog
 *    shows what leaves, and dissolves a series that would be left with a
 *    single member (resolveUnlinkScope).
 * A carried ⌘/Ctrl selection (sources.length > 1) links or unlinks as one:
 * every source files into the resolved series — a part-less source takes the
 * drop target's location, sources never donate to it — unless the linkage
 * matches (all sources in the target's series), when the drop pulls the
 * whole selection back out (resolveUnlinkScope may dissolve the series).
 * Save flows through photoService.updatePhoto; the attention event that
 * update fires already refreshes every open gallery, so no onChanged plumbing
 * is needed.
 */

'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { bodyPartDisplayLabel } from '@/types/body-part';
import { normalizeLesionGroup, reviewSeriesName } from '@/lib/utils/lesion-group';
import {
  resolveLinkInheritance,
  resolveLinkInheritancePair,
  resolveUnlinkScope,
  type PhotoLinkPlan,
} from '@/lib/utils/photo-link';
import { photoService } from '@/lib/services/photo-service';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface PhotoLinkDialogProps {
  /** The dragged photo(s) — a carried selection leads with the grabbed tile. */
  sources: PhotoRecord[];
  target: PhotoRecord | null;
  plan: PhotoLinkPlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired after a link or unlink save succeeds (not on cancel). The gallery
   * uses it to clear the selection that fed the drop.
   */
  onSaved?: () => void;
}

export function PhotoLinkDialog({
  sources,
  target,
  plan,
  open,
  onOpenChange,
  onSaved,
}: PhotoLinkDialogProps) {
  // Single-drag semantics (prefill, chips, unlink scope) read the grabbed
  // tile; a selection only ever links, which needs the whole list.
  const source = sources[0] ?? null;
  const multi = sources.length > 1;
  const [seriesInput, setSeriesInput] = useState('');
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  // Unlink mode: the series membership behind the dissolve decision, loaded
  // when the dialog opens (a series left with one member is dissolved).
  const [scope, setScope] = useState<{ photoIds: string[]; dissolve: boolean } | null>(null);
  const [scopeError, setScopeError] = useState(false);
  const [memberCount, setMemberCount] = useState(0);

  // Pre-fill the series name: the plan's resolved one, or — when neither
  // photo is in a series yet — a generated name in the same vocabulary as
  // review follow-ups ("<body part> — from <capture date>").
  useEffect(() => {
    if (!open || !source || !plan || !plan.ok || plan.action !== 'link') return;
    setSeriesInput(
      plan.seriesName ??
        reviewSeriesName({
          bodyPartLabel: bodyPartDisplayLabel(source.bodyPart, source.laterality),
          subpart: source.subpart,
          capturedAt: source.capturedAt,
        }),
    );
  }, [open, source, plan]);

  // Existing series chips for this patient (as the detail dialog offers).
  const patientId = source?.patientId;
  useEffect(() => {
    if (!open || !patientId || !plan || !plan.ok || plan.action !== 'link') return;
    let mounted = true;
    photoService
      .getLesionGroups(patientId)
      .then((groups) => {
        if (mounted) setExistingGroups(groups);
      })
      .catch(() => {
        if (mounted) setExistingGroups([]);
      });
    return () => {
      mounted = false;
    };
  }, [open, patientId, plan]);

  // Unlink mode: count the series' members so the dialog can say whether the
  // drop dissolves the whole series or just pulls one photo out of it.
  useEffect(() => {
    if (!open || !source || !plan || !plan.ok || plan.action !== 'unlink') return;
    let mounted = true;
    setScopeError(false);
    photoService
      .getPhotosInGroup(source.patientId, plan.seriesName)
      .then((members) => {
        if (!mounted) return;
        setMemberCount(members.length);
        // The leaving set is the plan's photoIds — the dragged photo alone,
        // or the whole carried selection.
        setScope(resolveUnlinkScope(members.map((m) => m.id), plan.photoIds));
      })
      .catch(() => {
        if (mounted) {
          setScope(null);
          setScopeError(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [open, source, plan]);

  if (!plan || !plan.ok || !source || !target) return null;

  const unlinking = plan.action === 'unlink';
  const normalised = normalizeLesionGroup(seriesInput);
  // Dragging between two different series only moves the dragged photo.
  const movingBetweenSeries =
    !!source.lesionGroup && !!target.lesionGroup && source.lesionGroup !== target.lesionGroup;
  // Whichever photo lacks a body part takes the other's — the single drop
  // goes either way (a part-less snap filed under the photo that has one, or
  // that photo dropped onto the part-less one). A carried selection is one
  // way only: part-less sources take the target's location, never the
  // reverse.
  const inheritances = unlinking || multi ? null : resolveLinkInheritancePair(source, target);
  const inherited = inheritances?.source ?? inheritances?.target ?? null;
  // "Left hand — knuckle" for the hint and toast.
  const inheritedLabel = inherited
    ? `${bodyPartDisplayLabel(inherited.bodyPart, inherited.laterality)}${inherited.subpart ? ` — ${inherited.subpart}` : ''}`
    : null;
  // Per-source location patches: the pair's dragged-photo side for a single
  // drop, each part-less source against the target for a selection.
  const sourcePatchById = new Map(
    sources.flatMap((s) => {
      const patch = multi
        ? resolveLinkInheritance(s, target)
        : (inheritances?.source ?? null);
      return patch ? [[s.id, patch] as const] : [];
    }),
  );
  // Multi hint: what part-less sources take, e.g. "Left hand — knuckle".
  const targetLabel = multi && target.bodyPart
    ? `${bodyPartDisplayLabel(target.bodyPart, target.laterality)}${target.subpart ? ` — ${target.subpart}` : ''}`
    : null;
  // Ids captured while source/target are known non-null — handleConfirm's
  // closure doesn't keep that narrowing.
  const targetId = target.id;

  async function handleConfirm() {
    if (!plan || !plan.ok) return;
    if (plan.action === 'link') {
      if (!normalised) return;
      setIsSaving(true);
      try {
        for (const id of plan.photoIds) {
          await photoService.updatePhoto(id, {
            lesionGroup: normalised,
            // Each patch belongs to its own photo; a photo that already has
            // a body part is never touched.
            ...(id === targetId && inheritances?.target ? inheritances.target : {}),
            ...(sourcePatchById.get(id) ?? {}),
          });
        }
        toast.success(
          multi
            ? `Linked ${sources.length} photos in series “${normalised}”`
            : `Linked in series “${normalised}”${
                inheritedLabel ? ` — location set to ${inheritedLabel}` : ''
              }`,
        );
        onSaved?.();
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to link photos');
      } finally {
        setIsSaving(false);
      }
    } else {
      if (!scope) return;
      setIsSaving(true);
      try {
        for (const id of scope.photoIds) {
          await photoService.updatePhoto(id, { lesionGroup: null });
        }
        toast.success(
          multi
            ? scope.dissolve
              ? `Series “${plan.seriesName}” dissolved`
              : `Removed ${scope.photoIds.length} photos from series “${plan.seriesName}”`
            : scope.dissolve
              ? `Series “${plan.seriesName}” dissolved`
              : `Removed from series “${plan.seriesName}”`,
        );
        onSaved?.();
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to unlink photos');
      } finally {
        setIsSaving(false);
      }
    }
  }

  const confirmDisabled = unlinking ? !scope : !normalised;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Bounded dialog: header and action bar stay put, the middle scrolls
          between them on short screens. */}
      <DialogContent className="flex max-h-[95dvh] flex-col overflow-hidden sm:max-w-md">
        {/* One form so Enter — in the series input or on the confirm button —
            confirms the drop instead of doing nothing. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleConfirm();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2">
            {unlinking ? (
              <Link2Off className="size-4" aria-hidden />
            ) : (
              <Link2 className="size-4" aria-hidden />
            )}
            {unlinking ? (multi ? 'Unlink photos' : 'Unlink photo') : 'Link photos'}
          </DialogTitle>
          <DialogDescription>
            {unlinking
              ? multi
                ? 'The selected photos are already in this series — confirm to pull them back out.'
                : 'The dragged photo is already in this series — confirm to pull it back out.'
              : multi
                ? `${sources.length} photos will share one lesion series — they badge together in the timeline and can be filtered as one.`
                : 'Both photos will share one lesion series — they badge together in the timeline and can be filtered as one.'}
          </DialogDescription>
        </DialogHeader>

        {/* Full-bleed scroll region — px-6 restores the dialog's inset; py-3
            keeps the series input's focus ring clear of the clip edge (the
            input ends this region whenever a fresh multi-link has no hints
            or chips), and gives the thumbs air below the description. */}
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-3">
        <div className="flex items-center justify-center gap-3">
          <LinkThumb photo={source} count={multi ? sources.length : undefined} />
          {unlinking ? (
            <Link2Off className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <LinkThumb photo={target} />
        </div>

        {unlinking ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Link2 className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{plan.seriesName}</span>
            </p>
            {!scope && !scopeError && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Checking the series…
              </p>
            )}
            {scopeError && (
              <p className="text-xs text-destructive">
                Couldn’t check the series — cancel and drop again.
              </p>
            )}
            {scope && scope.dissolve && multi && (
              <p className="text-xs text-muted-foreground">
                {scope.photoIds.length === memberCount
                  ? `All ${memberCount} photos leave the series — it dissolves.`
                  : 'The photos leave — one member would remain, so the series dissolves with them.'}
              </p>
            )}
            {scope && scope.dissolve && !multi && scope.photoIds.length === 2 && (
              <p className="text-xs text-muted-foreground">
                Both photos will leave the series — with no other members, it
                dissolves.
              </p>
            )}
            {scope && scope.dissolve && !multi && scope.photoIds.length === 1 && (
              <p className="text-xs text-muted-foreground">
                This photo is the series’ only member — removing it ends the
                series.
              </p>
            )}
            {scope && !scope.dissolve && (
              <p className="text-xs text-muted-foreground">
                {multi
                  ? `${scope.photoIds.length} photos leave the series — its other ${
                      memberCount - scope.photoIds.length
                    } photos stay linked.`
                  : `The photo leaves the series — its other ${memberCount - 1} photos stay linked.`}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="photo-link-series">Series name</Label>
            <Input
              id="photo-link-series"
              value={seriesInput}
              onChange={(e) => setSeriesInput(e.target.value)}
              maxLength={100}
              disabled={isSaving}
              autoFocus
            />
            {existingGroups.filter((g) => g !== seriesInput.trim()).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {existingGroups
                  .filter((g) => g !== seriesInput.trim())
                  .map((group) => (
                    <button
                      key={group}
                      type="button"
                      disabled={isSaving}
                      onClick={() => setSeriesInput(group)}
                      title={`Use the existing series “${group}”`}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <Link2 className="size-3" aria-hidden />
                      {group}
                    </button>
                  ))}
              </div>
            )}
            {!multi && (
              <p className="text-xs text-muted-foreground">
                {movingBetweenSeries
                  ? 'Only the dragged photo moves — its previous series keeps any other photos.'
                  : plan.photoIds.length === 2
                    ? 'Neither photo is in a series yet — this creates one.'
                    : 'One photo joins an existing series.'}
              </p>
            )}
            {multi && sources.some((s) => s.lesionGroup && s.lesionGroup !== plan.seriesName) && (
              <p className="text-xs text-muted-foreground">
                Photos already in another series move in — their previous series keeps any other
                photos.
              </p>
            )}
            {!multi && inherited && inheritedLabel && (
              <p className="text-xs text-muted-foreground">
                {inheritances?.source ? 'The dragged photo' : 'The photo you dropped onto'} has no
                body part — it takes {inheritedLabel}
                {inherited.pinX != null ? ', marked spot included,' : ''} from the other photo.
              </p>
            )}
            {multi && targetLabel && sources.some((s) => !s.bodyPart) && (
              <p className="text-xs text-muted-foreground">
                Photos without a body part take {targetLabel}
                {target.pinX != null ? ', marked spot included,' : ''} from the photo you dropped
                onto.
              </p>
            )}
          </div>
        )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving || confirmDisabled}>
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : unlinking ? (
              <Link2Off className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
            {unlinking ? 'Remove from series' : 'Link photos'}
          </Button>
        </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One side of the link: thumbnail + capture date, so the clinician can see
 * exactly which two shots are being joined before saving. A carried
 * selection shows its count on the dragged side — the other tiles ride
 * along unnamed.
 */
function LinkThumb({ photo, count }: { photo: PhotoRecord; count?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    photoService
      .exportPhotoAsDataUrl(photo.id, true)
      .then((u) => {
        if (mounted) setUrl(u);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [photo.id]);

  return (
    <span className="relative block h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
      {url ? (
        <img
          src={url}
          alt={`Photo from ${format(photo.capturedAt, 'd/M/yy')}`}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-center text-[9px] leading-3 text-white">
        {format(photo.capturedAt, 'd/M/yy')}
      </span>
      {count != null && count > 1 && (
        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow">
          {count}
        </span>
      )}
    </span>
  );
}
