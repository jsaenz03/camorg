/**
 * Brand palette derivation — pure colour maths, Node-importable (selfcheck).
 *
 * The admin picks at most two colours — a primary (buttons, links, focus
 * rings) and an accent (hover/highlight surfaces). This module derives every
 * shadcn CSS custom property Camog brands, for BOTH themes: the app follows
 * the OS theme via next-themes, so a dark-mode window must get its own
 * variants. The rules mirror the built-in Camog teal theme:
 *
 *  - light theme: the primary is the colour itself; its text ink is whichever
 *    of white / near-black reads better on it (WCAG 4.5:1 where reachable);
 *    accent surfaces are a very light tint of the accent colour.
 *  - dark theme: the primary is lightened just enough to read ≥4.5:1 against
 *    the near-black background; accent surfaces are a dark tint.
 *
 * Applying the returned CSS lives in components/branding-boot.tsx (DOM work
 * stays out of this module so the selfcheck can run it under plain Node).
 */

const WHITE = '#ffffff';
export const INK = '#1c1c1f'; // near-black text ink (≈ oklch(0.145 0 0))
/** ≈ the dark theme's background (oklch(0.145 0 0)) — contrast target for
 *  dark-mode primaries. */
export const DARK_BG = '#1c1c1f';
/** ≈ the dark theme's card colour (oklch(0.205 0 0)) — the base for dark
 *  accent surfaces. */
const DARK_SURFACE = '#26262b';

/** Accepts `#rgb`, `#rrggbb` or bare `rrggbb`; returns lowercase `#rrggbb`,
 *  or null for anything that isn't a colour (an unset field, junk). */
export function normaliseHex(input: string): string | null {
  const v = input.trim().replace(/^#/, '');
  const hex = v.length === 3 ? [...v].map((c) => c + c).join('') : v;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Mix `a` toward `b` by t (0 = a, 1 = b), in gamma-encoded sRGB — good
 *  enough for tints and predictable under test. */
export function mixHex(a: string, b: string, t: number): string {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t) as [number, number, number]);
}

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black — whichever reads better on the given colour. */
export function pickReadableInk(bg: string): string {
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, INK) ? WHITE : INK;
}

/** Lighten a colour toward white until it reads ≥4.5:1 on the dark
 *  background — a dark navy button would vanish on the dark theme. Already
 *  readable colours come back untouched. */
function readableOnDark(hex: string): string {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const candidate = mixHex(hex, WHITE, Math.min(t, 1));
    if (contrastRatio(candidate, DARK_BG) >= 4.5) return candidate;
  }
  return WHITE; // unreachable in practice: t=1 is white (21:1)
}

function brandVarSet(primary: string | null, accent: string | null, dark: boolean): string {
  const lines: string[] = [];
  if (primary) {
    const p = dark ? readableOnDark(primary) : primary;
    const ink = pickReadableInk(p);
    lines.push(
      `--primary: ${p};`,
      `--primary-foreground: ${ink};`,
      `--ring: ${p};`,
      `--sidebar-primary: ${p};`,
      `--sidebar-primary-foreground: ${ink};`,
      `--sidebar-ring: ${p};`,
    );
  }
  if (accent) {
    if (dark) {
      const surface = mixHex(accent, DARK_SURFACE, 0.85);
      const fg = mixHex(accent, WHITE, 0.88);
      lines.push(
        `--accent: ${surface};`,
        `--accent-foreground: ${fg};`,
        `--sidebar-accent: ${surface};`,
        `--sidebar-accent-foreground: ${fg};`,
      );
    } else {
      const surface = mixHex(accent, WHITE, 0.9);
      const fg = mixHex(accent, INK, 0.7);
      lines.push(
        `--accent: ${surface};`,
        `--accent-foreground: ${fg};`,
        `--sidebar-accent: ${surface};`,
        `--sidebar-accent-foreground: ${fg};`,
      );
    }
  }
  return lines.join('\n  ');
}

/**
 * The full stylesheet override for the two brand colours, or null when both
 * are unset (nothing to inject — the built-in Camog teal stands). The `.dark`
 * block comes second so it wins the specificity tie on `html.dark`.
 */
export function brandStyleCss(primary: string | null, accent: string | null): string | null {
  const p = normaliseHex(primary ?? '');
  const a = normaliseHex(accent ?? '');
  if (!p && !a) return null;
  return `:root {\n  ${brandVarSet(p, a, false)}\n}\n\n.dark {\n  ${brandVarSet(p, a, true)}\n}`;
}
