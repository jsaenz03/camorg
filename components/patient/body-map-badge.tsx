'use client';

/**
 * BodyMapBadge
 *
 * Tiny non-interactive body map showing where on the body a photo was taken,
 * with the region (and the patient's side, for paired regions) highlighted.
 * Designed to sit in a small white chip over photo thumbnails — the same
 * convention the phone companion uses, so both surfaces read alike. TORSO
 * owns no region of its own, so it lights up the trunk (chest + abdomen)
 * instead, keeping the overlay visible for every photo's body part.
 */

import type { CSSProperties } from 'react';
import {
  BACK,
  FRONT,
  NECK,
  PinMarker,
  patientSideOf,
  regionId,
  type RegionDef,
} from '@/components/patient/body-map-picker';
import { BILATERAL_BODY_PARTS, BodyPart, type BodyView, type Laterality, type Pinpoint } from '@/types/body-part';

interface BodyMapBadgeProps {
  bodyPart: BodyPart;
  laterality?: Laterality | null;
  /** Saved X mark; rendered only when it belongs to this body-view diagram. */
  pin?: Pinpoint | null;
  className?: string;
  style?: CSSProperties;
}

function Shape({ def, view, bodyPart, laterality }: { def: RegionDef; view: 'front' | 'back'; bodyPart: BodyPart; laterality?: Laterality | null }) {
  const key = regionId(def.part, def.kind, def.props);
  const side = patientSideOf(key, view);
  const hit =
    (def.part === bodyPart ||
      // TORSO is the general trunk label: stand-in highlight over the trunk.
      (bodyPart === BodyPart.TORSO &&
        (def.part === BodyPart.CHEST || def.part === BodyPart.ABDOMEN))) &&
    (!laterality || !BILATERAL_BODY_PARTS.has(bodyPart) || side === laterality);
  // Fixed dark neutrals rather than theme tokens: the badge always sits on a
  // white chip, so theme strokes would wash out in dark mode.
  const className = hit
    ? 'fill-primary stroke-primary'
    : 'fill-black/10 stroke-black/30';
  const common = { className, strokeWidth: 4 };
  // Stroke widths are in viewBox units (200x320), so they scale with the badge.
  // Kept thin: fat outlines swallow these small shapes and merge adjacent
  // regions into a doubled blob at thumbnail size.
  return def.kind === 'rect' ? (
    <rect {...(def.props as React.SVGProps<SVGRectElement>)} {...common} />
  ) : (
    <ellipse {...(def.props as React.SVGProps<SVGEllipseElement>)} {...common} />
  );
}

export function BodyMapBadge({ bodyPart, laterality, pin, className, style }: BodyMapBadgeProps) {
  // Which silhouette to show: the face the X was actually marked on, else the
  // part heuristic (back/scalp live on the back view).
  const view: BodyView = pin?.view ?? (bodyPart === 'back' || bodyPart === 'scalp' ? 'back' : 'front');
  return (
    <svg
      viewBox="0 0 200 320"
      // Intrinsic dimensions: WebKit resolves width:auto on attribute-less
      // SVGs inconsistently inside flex/absolute containers, which made the
      // figure vanish or stretch depending on viewport.
      width={200}
      height={320}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <Shape def={NECK} view={view} bodyPart={bodyPart} laterality={laterality} />
      {(view === 'front' ? FRONT : BACK).map((def, i) => (
        <Shape key={`${def.part}-${i}`} def={def} view={view} bodyPart={bodyPart} laterality={laterality} />
      ))}
      {/* Eyes: reads the silhouette as facing the patient (front view only) */}
      {view === 'front' && (
        <g aria-hidden="true">
          <circle cx={92} cy={49} r={2.2} className="fill-black/50" />
          <circle cx={108} cy={49} r={2.2} className="fill-black/50" />
        </g>
      )}
      {pin?.space === 'body' && <PinMarker pin={pin} />}
    </svg>
  );
}
