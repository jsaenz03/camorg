/**
 * PartDetailDiagram
 *
 * Zoomed, part-specific companion to the whole-body map: one simple geometric
 * diagram per BodyPart (TORSO has none — it is the chip-only overlap label,
 * never a clickable region). Same 200x320 viewBox as the body map so a
 * pinpoint normalizes identically in both diagrams. Shapes are backdrop only —
 * the parent svg owns the click handling and the X marker.
 *
 * The view prop picks the face: hands draw palm (front) vs back of hand with
 * fingernails (back); feet draw top of foot (front) vs sole (back). All other
 * parts are face-agnostic and ignore it. Every drawing shows the patient's
 * LEFT side; the component mirrors for the right.
 *
 * Two tones: 'auto' follows the app theme (the picker popover card); 'on-light'
 * uses fixed dark neutrals for the white chips in the photo detail dialog,
 * where theme strokes would wash out in dark mode.
 */

import type { ReactNode } from 'react';
import { BodyPart, type BodyPart as BodyPartType, type BodyView, type Laterality } from '@/types/body-part';

export type PartDetailTone = 'auto' | 'on-light';

interface Palette {
  shape: string;
  hint: string;
}

const PALETTES: Record<PartDetailTone, Palette> = {
  auto: { shape: 'fill-muted-foreground/15 stroke-border', hint: 'stroke-border' },
  'on-light': { shape: 'fill-black/10 stroke-black/25', hint: 'stroke-black/30' },
};

// Builders receive the view so parts with distinct front/back faces (hands,
// feet) can draw each one. All drawings show the patient's LEFT side; the
// component mirrors for the right.
const DETAIL_DIAGRAMS: Partial<Record<BodyPartType, (p: Palette, view: BodyView) => ReactNode>> = {
  [BodyPart.HEAD]: ({ shape }) => (
    <>
      <ellipse cx={100} cy={150} rx={68} ry={92} className={shape} />
      <rect x={82} y={232} width={36} height={52} rx={12} className={shape} />
    </>
  ),
  [BodyPart.FACE]: ({ shape, hint }) => (
    <>
      <ellipse cx={100} cy={160} rx={64} ry={88} className={shape} />
      <circle cx={74} cy={132} r={8} className={hint} fill="none" strokeWidth={2} />
      <circle cx={126} cy={132} r={8} className={hint} fill="none" strokeWidth={2} />
      <line x1={100} y1={148} x2={100} y2={180} className={hint} strokeWidth={2} />
      <line x1={74} y1={208} x2={126} y2={208} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.SCALP]: ({ shape, hint }) => (
    <>
      <ellipse cx={100} cy={170} rx={74} ry={102} className={shape} />
      <path d="M36 130 Q100 62 164 130" className={hint} fill="none" strokeWidth={2} />
      <path d="M52 100 Q100 48 148 100" className={hint} fill="none" strokeWidth={2} />
    </>
  ),
  [BodyPart.NECK]: ({ shape }) => (
    <>
      <ellipse cx={100} cy={66} rx={56} ry={46} className={shape} />
      <rect x={62} y={98} width={76} height={186} rx={30} className={shape} />
    </>
  ),
  [BodyPart.CHEST]: ({ shape, hint }) => (
    <>
      <rect x={40} y={58} width={120} height={192} rx={24} className={shape} />
      <line x1={54} y1={88} x2={94} y2={100} className={hint} strokeWidth={2} />
      <line x1={146} y1={88} x2={106} y2={100} className={hint} strokeWidth={2} />
      <line x1={100} y1={100} x2={100} y2={180} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.ABDOMEN]: ({ shape, hint }) => (
    <>
      <rect x={45} y={48} width={110} height={222} rx={24} className={shape} />
      <line x1={100} y1={108} x2={100} y2={252} className={hint} strokeWidth={2} />
      <line x1={45} y1={180} x2={155} y2={180} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.BACK]: ({ shape, hint }) => (
    <>
      <rect x={40} y={55} width={120} height={210} rx={24} className={shape} />
      <line x1={100} y1={80} x2={100} y2={246} className={hint} strokeWidth={2} />
      <ellipse cx={66} cy={128} rx={18} ry={28} className={hint} fill="none" strokeWidth={2} />
      <ellipse cx={134} cy={128} rx={18} ry={28} className={hint} fill="none" strokeWidth={2} />
    </>
  ),
  [BodyPart.UPPER_ARM]: ({ shape, hint }) => (
    <>
      <ellipse cx={100} cy={52} rx={46} ry={34} className={shape} />
      <rect x={68} y={70} width={64} height={200} rx={30} className={shape} />
      <line x1={80} y1={252} x2={120} y2={252} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.FOREARM]: ({ shape, hint }) => (
    <>
      <ellipse cx={100} cy={44} rx={38} ry={26} className={shape} />
      <rect x={72} y={60} width={56} height={202} rx={26} className={shape} />
      <line x1={82} y1={242} x2={82} y2={260} className={hint} strokeWidth={2} />
      <line x1={118} y1={242} x2={118} y2={260} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.HAND]: ({ shape, hint }, view) =>
    view === 'back' ? (
      <>
        {/* Back of hand: fingernails; thumb on the viewer's right */}
        <rect x={61} y={78} width={17} height={72} rx={8} className={shape} />
        <rect x={82} y={66} width={17} height={84} rx={8} className={shape} />
        <rect x={103} y={60} width={17} height={90} rx={8} className={shape} />
        <rect x={124} y={72} width={17} height={78} rx={8} className={shape} />
        <rect x={60} y={142} width={82} height={100} rx={22} className={shape} />
        <ellipse cx={156} cy={190} rx={16} ry={30} transform="rotate(30 156 190)" className={shape} />
        <rect x={76} y={236} width={50} height={48} rx={16} className={shape} />
        <ellipse cx={69.5} cy={87} rx={4.5} ry={6} className={hint} fill="none" strokeWidth={2} />
        <ellipse cx={90.5} cy={75} rx={4.5} ry={6} className={hint} fill="none" strokeWidth={2} />
        <ellipse cx={111.5} cy={69} rx={4.5} ry={6} className={hint} fill="none" strokeWidth={2} />
        <ellipse cx={132.5} cy={81} rx={4.5} ry={6} className={hint} fill="none" strokeWidth={2} />
      </>
    ) : (
      <>
        {/* Palm: creases, no nails; thumb on the viewer's left */}
        <rect x={61} y={72} width={17} height={78} rx={8} className={shape} />
        <rect x={82} y={60} width={17} height={90} rx={8} className={shape} />
        <rect x={103} y={66} width={17} height={84} rx={8} className={shape} />
        <rect x={124} y={78} width={17} height={72} rx={8} className={shape} />
        <rect x={60} y={142} width={82} height={100} rx={22} className={shape} />
        <ellipse cx={44} cy={190} rx={16} ry={30} transform="rotate(-30 44 190)" className={shape} />
        <rect x={76} y={236} width={50} height={48} rx={16} className={shape} />
        <path d="M132 176 Q100 192 68 176" className={hint} fill="none" strokeWidth={2} />
        <path d="M130 208 Q98 224 70 206" className={hint} fill="none" strokeWidth={2} />
        <path d="M64 182 Q68 226 96 242" className={hint} fill="none" strokeWidth={2} />
      </>
    ),
  [BodyPart.THIGH]: ({ shape, hint }) => (
    <>
      <ellipse cx={100} cy={44} rx={48} ry={34} className={shape} />
      <rect x={64} y={64} width={72} height={216} rx={32} className={shape} />
      <line x1={80} y1={266} x2={120} y2={266} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.LEG]: ({ shape, hint }) => (
    <>
      <ellipse cx={100} cy={40} rx={36} ry={26} className={shape} />
      <rect x={72} y={56} width={56} height={204} rx={26} className={shape} />
      <line x1={82} y1={244} x2={82} y2={262} className={hint} strokeWidth={2} />
      <line x1={118} y1={244} x2={118} y2={262} className={hint} strokeWidth={2} />
    </>
  ),
  [BodyPart.FOOT]: ({ shape, hint }, view) =>
    view === 'back' ? (
      <>
        {/* Sole: toe pads just touching the top edge; big toe on viewer's left */}
        <rect x={59} y={84} width={82} height={204} rx={28} className={shape} />
        <circle cx={68} cy={83} r={10.5} className={hint} fill="none" strokeWidth={2} />
        <circle cx={83} cy={78} r={8.5} className={hint} fill="none" strokeWidth={2} />
        <circle cx={101} cy={77} r={9} className={hint} fill="none" strokeWidth={2} />
        <circle cx={119} cy={78} r={8.5} className={hint} fill="none" strokeWidth={2} />
        <circle cx={134} cy={87} r={8} className={hint} fill="none" strokeWidth={2} />
      </>
    ) : (
      <>
        {/* Top of foot: rounded-rect body, toes + toenails just touching the
            top edge; big toe on viewer's right */}
        <rect x={59} y={84} width={82} height={204} rx={28} className={shape} />
        <circle cx={66} cy={87} r={8} className={shape} />
        <circle cx={81} cy={78} r={8.5} className={shape} />
        <circle cx={99} cy={77} r={9} className={shape} />
        <circle cx={117} cy={78} r={8.5} className={shape} />
        <circle cx={132} cy={83} r={10.5} className={shape} />
        <circle cx={66} cy={82} r={2.8} className={hint} fill="none" strokeWidth={1.5} />
        <circle cx={81} cy={72.5} r={3} className={hint} fill="none" strokeWidth={1.5} />
        <circle cx={99} cy={71} r={3.2} className={hint} fill="none" strokeWidth={1.5} />
        <circle cx={117} cy={72.5} r={3} className={hint} fill="none" strokeWidth={1.5} />
        <circle cx={132} cy={75.5} r={3.6} className={hint} fill="none" strokeWidth={1.5} />
      </>
    ),
};

export function hasPartDetail(part: BodyPartType): boolean {
  return part in DETAIL_DIAGRAMS;
}

export function PartDetailDiagram({
  part,
  side,
  view = 'front',
  tone = 'auto',
}: {
  part: BodyPartType;
  side: Laterality | null;
  /** Which face to draw — only hands and feet differ (palm vs back of hand). */
  view?: BodyView;
  tone?: PartDetailTone;
}) {
  const build = DETAIL_DIAGRAMS[part];
  if (!build) return null;
  // Central parts pass side=null; mirroring symmetric shapes would be a no-op
  // anyway, so the check is only about the patient's side being 'right'.
  const diagram = build(PALETTES[tone], view);
  return side === 'right' ? <g transform="scale(-1 1) translate(-200 0)">{diagram}</g> : diagram;
}
