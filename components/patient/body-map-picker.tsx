'use client';

/**
 * BodyMapPicker
 *
 * Clickable anatomical diagram that sets the body part. Front view covers the
 * anterior regions; back view adds BACK and posterior SCALP. The diagram is a
 * deliberately simple geometric silhouette (no external assets) — precision
 * comes from the subpart text field, this just beats a flat dropdown.
 *
 * Regions map 1:1 onto the BodyPart enum; TORSO is offered as a chip because
 * it overlaps the trunk regions rather than owning area of its own.
 */

import { useState, type SVGProps } from 'react';
import { PersonStanding } from 'lucide-react';
import { BodyPart, type BodyPart as BodyPartType } from '@/types/body-part';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type View = 'front' | 'back';

interface RegionDef {
  part: BodyPartType;
  // Static geometry shared by both views where noted.
  props: Omit<SVGProps<SVGRectElement> & SVGProps<SVGEllipseElement>, 'ref'>;
  kind: 'rect' | 'ellipse';
}

// Front-view regions. Paint order matters: later shapes sit on top and win
// pointer events (scalp strip and face oval over the head, chest/abdomen over
// the trunk).
const FRONT: RegionDef[] = [
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
const BACK: RegionDef[] = [
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
const NECK: RegionDef = { part: BodyPart.NECK, kind: 'rect', props: { x: 90, y: 74, width: 20, height: 14, rx: 5 } };

// Stable id for a region: part + screen side. Derived from geometry because
// array indices differ between the front and back views, so an index-based id
// would jump to the opposite limb when the view flips.
function regionId(part: BodyPartType, kind: 'rect' | 'ellipse', props: RegionDef['props']): string {
  const mid = kind === 'ellipse' ? Number(props.cx) : Number(props.x) + Number(props.width) / 2;
  const side = mid < 100 ? 'left' : mid > 100 ? 'right' : 'center';
  return `${part}-${side}`;
}

interface BodyMapPickerProps {
  value: BodyPartType | undefined;
  onSelect: (part: BodyPartType) => void;
  disabled?: boolean;
}

export function BodyMapPicker({ value, onSelect, disabled }: BodyMapPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('front');
  // Which of a bilateral pair was last clicked, so only that side highlights.
  // Null until the user clicks: a value arriving from the form carries no
  // side, so both regions of that part highlight.
  const [picked, setPicked] = useState<{ part: BodyPartType; key: string } | null>(null);
  const regions = view === 'front' ? FRONT : BACK;
  const neckKey = regionId(NECK.part, NECK.kind, NECK.props);

  const handleSelect = (part: BodyPartType, key: string) => {
    setPicked({ part, key });
    onSelect(part);
  };

  // A picked side only narrows the highlight while it belongs to the current
  // value; any other part shows all of its regions.
  const isSelected = (part: BodyPartType, key: string) =>
    value === part && (picked?.part !== part || picked.key === key);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="gap-2">
          <PersonStanding className="size-4" />
          Pick on body map
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Body map view">
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
          <span className="text-xs text-muted-foreground">Click a region</span>
        </div>

        <svg
          viewBox="0 0 200 320"
          className="h-72 w-auto select-none"
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
        </svg>

        <div className="mt-2 flex items-center justify-between">
          <Button
            type="button"
            variant={value === BodyPart.TORSO ? 'secondary' : 'ghost'}
            size="sm"
            className="text-xs"
            onClick={() => onSelect(BodyPart.TORSO)}
          >
            Torso (general)
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
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
  onSelect: (part: BodyPartType, key: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const className = cn(
    'cursor-pointer stroke-[1.5px] transition-[fill] duration-75',
    selected ? 'fill-primary stroke-primary' : hovered ? 'fill-primary/40 stroke-primary/50' : 'fill-muted-foreground/25 stroke-border',
  );
  const common = {
    className,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: () => onSelect(part, regionKey),
    // Keyboard reachability for the diagram regions.
    tabIndex: 0,
    role: 'button',
    'aria-label': `Select ${part.replace('_', ' ')} region`,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(part, regionKey);
      }
    },
  };
  return kind === 'rect' ? <rect {...(props as SVGProps<SVGRectElement>)} {...common} /> : <ellipse {...(props as SVGProps<SVGEllipseElement>)} {...common} />;
}
