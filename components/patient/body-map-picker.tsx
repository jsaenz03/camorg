'use client';

/**
 * BodyMapPicker
 *
 * Clickable anatomical diagram that sets the body part. Front view covers the
 * anterior regions; back view adds BACK and posterior SCALP. The diagram is a
 * deliberately simple geometric silhouette (no external assets) — precision
 * comes from the subpart text field and the pinpoint X, this just beats a flat
 * dropdown.
 *
 * Regions map 1:1 onto the BodyPart enum; TORSO is offered as a chip because
 * it overlaps the trunk regions rather than owning area of its own.
 *
 * Two-level pinpointing: clicking a region selects the part (same mapping as
 * ever) AND drops an X at the exact click point, then opens that part's zoomed
 * detail diagram where a second click refines the X (see part-detail-diagram).
 * The pin's normalized coordinates ride along via onPinChange; 'space' records
 * which diagram they belong to.
 */

import { useState, type SVGProps } from 'react';
import { ArrowLeft, PersonStanding } from 'lucide-react';
import {
  BodyPart,
  BILATERAL_BODY_PARTS,
  SURFACE_LABELS,
  bodyPartSurfaceLabel,
  type BodyPart as BodyPartType,
  type BodyView,
  type Laterality,
  type Pinpoint,
} from '@/types/body-part';
import { PartDetailDiagram, hasPartDetail } from '@/components/patient/part-detail-diagram';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type View = BodyView;

export interface RegionDef {
  part: BodyPartType;
  // Static geometry shared by both views where noted.
  props: Omit<SVGProps<SVGRectElement> & SVGProps<SVGEllipseElement>, 'ref'>;
  kind: 'rect' | 'ellipse';
}

// Front-view regions. Paint order matters: later shapes sit on top and win
// pointer events (scalp strip and face oval over the head, chest/abdomen over
// the trunk).
export const FRONT: RegionDef[] = [
  // head (outer)
  { part: BodyPart.HEAD, kind: 'ellipse', props: { cx: 100, cy: 46, rx: 26, ry: 32 } },
  // trunk
  { part: BodyPart.CHEST, kind: 'rect', props: { x: 76, y: 84, width: 48, height: 38, rx: 10 } },
  { part: BodyPart.ABDOMEN, kind: 'rect', props: { x: 78, y: 124, width: 44, height: 44, rx: 10 } },
  // arms
  { part: BodyPart.UPPER_ARM, kind: 'rect', props: { x: 48, y: 88, width: 20, height: 46, rx: 10 } },
  { part: BodyPart.UPPER_ARM, kind: 'rect', props: { x: 132, y: 88, width: 20, height: 46, rx: 10 } },
  { part: BodyPart.FOREARM, kind: 'rect', props: { x: 46, y: 138, width: 18, height: 44, rx: 9 } },
  { part: BodyPart.FOREARM, kind: 'rect', props: { x: 136, y: 138, width: 18, height: 44, rx: 9 } },
  { part: BodyPart.HAND, kind: 'ellipse', props: { cx: 55, cy: 194, rx: 11, ry: 13 } },
  { part: BodyPart.HAND, kind: 'ellipse', props: { cx: 145, cy: 194, rx: 11, ry: 13 } },
  // legs
  { part: BodyPart.THIGH, kind: 'rect', props: { x: 78, y: 172, width: 20, height: 56, rx: 10 } },
  { part: BodyPart.THIGH, kind: 'rect', props: { x: 102, y: 172, width: 20, height: 56, rx: 10 } },
  { part: BodyPart.LEG, kind: 'rect', props: { x: 78, y: 232, width: 18, height: 52, rx: 9 } },
  { part: BodyPart.LEG, kind: 'rect', props: { x: 104, y: 232, width: 18, height: 52, rx: 9 } },
  { part: BodyPart.FOOT, kind: 'ellipse', props: { cx: 84, cy: 296, rx: 11, ry: 9 } },
  { part: BodyPart.FOOT, kind: 'ellipse', props: { cx: 116, cy: 296, rx: 11, ry: 9 } },
  // face + scalp sit on top of the head
  { part: BodyPart.FACE, kind: 'ellipse', props: { cx: 100, cy: 54, rx: 17, ry: 21 } },
  { part: BodyPart.SCALP, kind: 'rect', props: { x: 82, y: 14, width: 36, height: 12, rx: 6 } },
];

// Back view: same limbs, BACK trunk, SCALP on the back of the head.
export const BACK: RegionDef[] = [
  { part: BodyPart.HEAD, kind: 'ellipse', props: { cx: 100, cy: 46, rx: 26, ry: 32 } },
  { part: BodyPart.BACK, kind: 'rect', props: { x: 76, y: 84, width: 48, height: 84, rx: 10 } },
  { part: BodyPart.UPPER_ARM, kind: 'rect', props: { x: 48, y: 88, width: 20, height: 46, rx: 10 } },
  { part: BodyPart.UPPER_ARM, kind: 'rect', props: { x: 132, y: 88, width: 20, height: 46, rx: 10 } },
  { part: BodyPart.FOREARM, kind: 'rect', props: { x: 46, y: 138, width: 18, height: 44, rx: 9 } },
  { part: BodyPart.FOREARM, kind: 'rect', props: { x: 136, y: 138, width: 18, height: 44, rx: 9 } },
  { part: BodyPart.HAND, kind: 'ellipse', props: { cx: 55, cy: 194, rx: 11, ry: 13 } },
  { part: BodyPart.HAND, kind: 'ellipse', props: { cx: 145, cy: 194, rx: 11, ry: 13 } },
  { part: BodyPart.THIGH, kind: 'rect', props: { x: 78, y: 172, width: 20, height: 56, rx: 10 } },
  { part: BodyPart.THIGH, kind: 'rect', props: { x: 102, y: 172, width: 20, height: 56, rx: 10 } },
  { part: BodyPart.LEG, kind: 'rect', props: { x: 78, y: 232, width: 18, height: 52, rx: 9 } },
  { part: BodyPart.LEG, kind: 'rect', props: { x: 104, y: 232, width: 18, height: 52, rx: 9 } },
  { part: BodyPart.FOOT, kind: 'ellipse', props: { cx: 84, cy: 296, rx: 11, ry: 9 } },
  { part: BodyPart.FOOT, kind: 'ellipse', props: { cx: 116, cy: 296, rx: 11, ry: 9 } },
  { part: BodyPart.SCALP, kind: 'ellipse', props: { cx: 100, cy: 40, rx: 18, ry: 16 } },
];

// Neck: anatomical filler between head and trunk, selectable in both views.
export const NECK: RegionDef = { part: BodyPart.NECK, kind: 'rect', props: { x: 90, y: 74, width: 20, height: 14, rx: 5 } };

// Stable id for a region: part + screen side. Derived from geometry because
// array indices differ between the front and back views, so an index-based id
// would jump to the opposite limb when the view flips.
export function regionId(part: BodyPartType, kind: 'rect' | 'ellipse', props: RegionDef['props']): string {
  const mid = kind === 'ellipse' ? Number(props.cx) : Number(props.x) + Number(props.width) / 2;
  const side = mid < 100 ? 'left' : mid > 100 ? 'right' : 'center';
  return `${part}-${side}`;
}

/** Center of a region in normalized diagram coordinates (keyboard fallback). */
function regionCenter(def: RegionDef): { x: number; y: number } {
  const p = def.props;
  return def.kind === 'ellipse'
    ? { x: Number(p.cx) / 200, y: Number(p.cy) / 320 }
    : { x: (Number(p.x) + Number(p.width) / 2) / 200, y: (Number(p.y) + Number(p.height) / 2) / 320 };
}

/** Pointer position normalized to the 200x320 viewBox of the SVG under the
 * click. currentTarget is a region shape on the body map, or the root <svg>
 * itself in the detail view — a root svg's ownerSVGElement is null, hence the
 * fallback to itself. getScreenCTM maps through viewBox scaling and any CSS
 * transforms, so the point lands exactly where the user clicked. */
function normalizedPoint(e: React.MouseEvent<SVGElement>): { x: number; y: number } {
  const svg = (e.currentTarget.ownerSVGElement ?? e.currentTarget) as SVGSVGElement | null;
  const ctm = svg?.getScreenCTM();
  if (!ctm) return { x: 0.5, y: 0.5 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return {
    x: Math.min(1, Math.max(0, p.x / 200)),
    y: Math.min(1, Math.max(0, p.y / 320)),
  };
}

/**
 * The X mark itself, in 200x320 viewBox coordinates. White halo underneath so
 * it reads over any diagram fill, in the picker or on a badge.
 */
export function PinMarker({ pin, span = 9 }: { pin: Pinpoint; span?: number }) {
  const x = pin.x * 200;
  const y = pin.y * 320;
  const d = `M${x - span} ${y - span} L${x + span} ${y + span} M${x - span} ${y + span} L${x + span} ${y - span}`;
  return (
    <g className="pointer-events-none" aria-hidden="true">
      <path d={d} stroke="white" strokeWidth={7} strokeLinecap="round" fill="none" />
      <path d={d} className="stroke-destructive" strokeWidth={3.5} strokeLinecap="round" fill="none" />
    </g>
  );
}

// The PATIENT's side of a region in the given view. The front view mirrors
// (the patient's right limb is on the viewer's left); the back view does not.
// Central regions (head, trunk) have no side.
export function patientSideOf(regionKey: string, view: View): Laterality | 'center' {
  const screenSide = regionKey.endsWith('-left')
    ? 'left'
    : regionKey.endsWith('-right')
      ? 'right'
      : 'center';
  if (screenSide === 'center') return 'center';
  if (view === 'front') return screenSide === 'left' ? 'right' : 'left';
  return screenSide;
}

interface BodyMapPickerProps {
  value: BodyPartType | undefined;
  /** Currently chosen side, so only that half of a bilateral part highlights. */
  laterality?: Laterality | null;
  onSelect: (part: BodyPartType, laterality: Laterality | null) => void;
  /** Where the X currently sits, or null. Coordinates are diagram-relative. */
  pin?: Pinpoint | null;
  onPinChange?: (pin: Pinpoint | null) => void;
  disabled?: boolean;
}

export function BodyMapPicker({ value, laterality, onSelect, pin, onPinChange, disabled }: BodyMapPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('front');
  // Which of a bilateral pair was last clicked, so only that side highlights.
  // The laterality prop narrows too once the form has it; `picked` covers the
  // instant between click and form sync (and callers that don't track sides).
  const [picked, setPicked] = useState<{ part: BodyPartType; key: string } | null>(null);
  // Non-null while the zoomed part diagram is shown instead of the body. The
  // view is the face being marked (palm vs back of hand for a hand); it starts
  // from the body view the part was clicked on, or from a saved part-space
  // pin's view so the stored X renders on the diagram it was placed on.
  const [detail, setDetail] = useState<{ part: BodyPartType; side: Laterality | null; view: BodyView } | null>(null);
  const regions = view === 'front' ? FRONT : BACK;
  const neckKey = regionId(NECK.part, NECK.kind, NECK.props);

  const handleSelect = (
    part: BodyPartType,
    key: string,
    geometry: RegionDef,
    point: { x: number; y: number },
  ) => {
    setPicked({ part, key });
    const side = patientSideOf(key, view);
    const isBilateral = BILATERAL_BODY_PARTS.has(part) && side !== 'center';
    onSelect(part, isBilateral ? side : null);
    onPinChange?.({ ...point, space: 'body', view });
    if (hasPartDetail(part)) {
      const savedView = pin?.space === 'part' && value === part ? pin.view : view;
      setDetail({ part, side: isBilateral ? side : null, view: savedView });
    }
  };

  // Flip the face shown in the detail view (palm ↔ back of hand). A part-space
  // X keeps its coordinates — the hand/foot outline is shared — and is retagged
  // so what's saved always matches the surface on screen.
  const setSurfaceView = (next: BodyView) => {
    setDetail((d) => (d ? { ...d, view: next } : d));
    if (pin?.space === 'part') onPinChange?.({ ...pin, view: next });
  };

  // A picked side (or the tracked laterality) only narrows the highlight
  // while it belongs to the current value; any other part shows all regions.
  const isSelected = (part: BodyPartType, key: string) => {
    if (value !== part) return false;
    if (!BILATERAL_BODY_PARTS.has(part)) return true;
    if (laterality) return patientSideOf(key, view) === laterality;
    if (picked?.part === part) return picked.key === key;
    return true;
  };

  const closePopover = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setDetail(null);
  };

  return (
    <Popover open={open} onOpenChange={closePopover}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="gap-2">
          <PersonStanding className="size-4" />
          Pick on body map
        </Button>
      </PopoverTrigger>
      {/* Fixed width sized by the diagram (240px + padding) so the header and
          footer can never widen the popover and leave dead space beside the
          map — the diagram is the content here. */}
      <PopoverContent align="start" className="w-[264px] p-3">
        {detail ? (
          <div>
            <div className="mb-2 flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-xs"
                onClick={() => setDetail(null)}
              >
                <ArrowLeft className="size-3.5" />
                Body map
              </Button>
              <span className="truncate text-sm font-medium">
                {bodyPartSurfaceLabel(detail.part, detail.side, detail.view)}
              </span>
            </div>

            {/* Hands and feet have distinct front/back faces — make the one
                being marked explicit (and switchable) so a back-of-hand X can
                never masquerade as a palm mark. */}
            {SURFACE_LABELS[detail.part] && (
              <div className="mb-2 flex w-fit justify-center rounded-md border p-0.5 mx-auto" role="group" aria-label="Surface marked">
                {(['front', 'back'] as BodyView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={detail.view === v}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      detail.view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                    onClick={() => setSurfaceView(v)}
                  >
                    {SURFACE_LABELS[detail.part]![v]}
                  </button>
                ))}
              </div>
            )}

            <svg
              viewBox="0 0 200 320"
              width={240}
              height={384}
              className="h-auto w-[240px] cursor-crosshair select-none"
              role="button"
              tabIndex={0}
              aria-label={`Mark the exact spot on ${bodyPartSurfaceLabel(detail.part, detail.side, detail.view)}`}
              onClick={(e) => onPinChange?.({ ...normalizedPoint(e), space: 'part', view: detail.view })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPinChange?.({ x: 0.5, y: 0.5, space: 'part', view: detail.view });
                }
              }}
            >
              <PartDetailDiagram part={detail.part} side={detail.side} view={detail.view} />
              {pin?.space === 'part' && <PinMarker pin={pin} />}
            </svg>

            <p className="mt-1 text-center text-xs text-muted-foreground">
              Click to mark the exact spot with an X.
            </p>

            <div className="mt-2 flex justify-end">
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => closePopover(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex w-fit rounded-md border p-0.5" role="group" aria-label="Body map view">
              {(['front', 'back'] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>

            <svg
              viewBox="0 0 200 320"
              width={240}
              height={384}
              className="h-auto w-[240px] select-none"
              role="img"
              aria-label={`Body map, ${view} view`}
            >
              {/* neck: anatomical filler, also selectable */}
              <RegionShape
                part={NECK.part}
                kind={NECK.kind}
                props={NECK.props}
                regionKey={neckKey}
                selected={isSelected(NECK.part, neckKey)}
                onSelect={handleSelect}
              />
              {regions.map((r, i) => {
                const key = regionId(r.part, r.kind, r.props);
                return (
                  <RegionShape
                    key={`${r.part}-${i}`}
                    part={r.part}
                    kind={r.kind}
                    props={r.props}
                    regionKey={key}
                    selected={isSelected(r.part, key)}
                    onSelect={handleSelect}
                  />
                );
              })}
              {/* Eyes: the front view must read as facing the patient at a glance */}
              {view === 'front' && (
                <g className="pointer-events-none" aria-hidden="true">
                  <circle cx={92} cy={49} r={2.2} className="fill-foreground/70" />
                  <circle cx={108} cy={49} r={2.2} className="fill-foreground/70" />
                </g>
              )}
              {pin?.space === 'body' && <PinMarker pin={pin} />}
            </svg>

            <p className="mt-1 text-center text-xs text-muted-foreground">
              {view === 'front' ? 'Front — facing the patient.' : 'Back — seen from behind.'}{' '}
              Click a region, then mark the exact spot.
            </p>

            <div className="mt-2 flex items-center justify-between">
              <Button
                type="button"
                variant={value === BodyPart.TORSO ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs"
                onClick={() => {
                  onSelect(BodyPart.TORSO, null);
                  onPinChange?.(null);
                }}
              >
                Torso (general)
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => closePopover(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RegionShape({
  part,
  kind,
  props,
  regionKey,
  selected,
  onSelect,
}: {
  part: BodyPartType;
  kind: 'rect' | 'ellipse';
  props: RegionDef['props'];
  regionKey: string;
  selected: boolean;
  onSelect: (part: BodyPartType, key: string, geometry: RegionDef, point: { x: number; y: number }) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const className = cn(
    'cursor-pointer stroke-[1.5px] transition-[fill] duration-75',
    selected ? 'fill-primary stroke-primary' : hovered ? 'fill-primary/40 stroke-primary/50' : 'fill-muted-foreground/25 stroke-border',
  );
  const geometry: RegionDef = { part, kind, props };
  const activate = (e: React.MouseEvent<SVGElement>) => onSelect(part, regionKey, geometry, normalizedPoint(e));
  const common = {
    className,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: activate,
    // Keyboard reachability for the diagram regions.
    tabIndex: 0,
    role: 'button',
    'aria-label': `Select ${part.replace('_', ' ')} region`,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(part, regionKey, geometry, regionCenter(geometry));
      }
    },
  };
  return kind === 'rect' ? <rect {...(props as SVGProps<SVGRectElement>)} {...common} /> : <ellipse {...(props as SVGProps<SVGEllipseElement>)} {...common} />;
}
