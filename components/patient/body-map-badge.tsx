'use client';

/**
 * BodyMapBadge
 *
 * Tiny non-interactive body map showing where on the body a photo was taken,
 * with the region (and the patient's side, for paired regions) highlighted.
 * Designed to sit in a small dark chip over photo thumbnails — the same
 * convention the phone companion uses, so both surfaces read alike.
 */

import type { CSSProperties } from 'react';
import {
  BACK,
  FRONT,
  NECK,
  patientSideOf,
  regionId,
  type RegionDef,
} from '@/components/patient/body-map-picker';
import { BILATERAL_BODY_PARTS, type BodyPart, type Laterality } from '@/types/body-part';

interface BodyMapBadgeProps {
  bodyPart: BodyPart;
  laterality?: Laterality | null;
  className?: string;
  style?: CSSProperties;
}

function Shape({ def, view, bodyPart, laterality }: { def: RegionDef; view: 'front' | 'back'; bodyPart: BodyPart; laterality?: Laterality | null }) {
  const key = regionId(def.part, def.kind, def.props);
  const side = patientSideOf(key, view);
  const hit =
    def.part === bodyPart &&
    (!laterality || !BILATERAL_BODY_PARTS.has(bodyPart) || side === laterality);
  const className = hit
    ? 'fill-primary stroke-primary'
    : 'fill-white/25 stroke-white/40';
  const common = { className, strokeWidth: 12 };
  // Stroke widths are in viewBox units (200x320), so they scale with the badge.
  return def.kind === 'rect' ? (
    <rect {...(def.props as React.SVGProps<SVGRectElement>)} {...common} />
  ) : (
    <ellipse {...(def.props as React.SVGProps<SVGEllipseElement>)} {...common} />
  );
}

export function BodyMapBadge({ bodyPart, laterality, className, style }: BodyMapBadgeProps) {
  const view = bodyPart === 'back' || bodyPart === 'scalp' ? 'back' : 'front';
  return (
    <svg
      viewBox="0 0 200 320"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <Shape def={NECK} view={view} bodyPart={bodyPart} laterality={laterality} />
      {(view === 'front' ? FRONT : BACK).map((def, i) => (
        <Shape key={`${def.part}-${i}`} def={def} view={view} bodyPart={bodyPart} laterality={laterality} />
      ))}
    </svg>
  );
}
