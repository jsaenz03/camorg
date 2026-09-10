/**
 * rtfToPlainText: best-effort RTF → readable text for the result-file preview.
 *
 * Pure regex stripping — no RTF parser. Good enough to read a referral letter
 * in-app; "Save a copy" remains the escape hatch for exact fidelity.
 *
 * ponytail: \'hh escapes decode as latin-1, so cp1252-only bytes (curly quotes
 * at 0x80–0x9F) come out wrong, and deeply nested destination groups can leak
 * stray glyphs. Upgrade path: a real RTF parser if malformed previews matter.
 */

/** Groups whose first control word marks them as machine data, not body text
 *  ({\*\…} ignorable destinations, font/colour tables, embedded images, …).
 *  One nesting level is allowed inline; the loop below unrolls deeper ones. */
const DESTINATION_GROUP =
  /\{\\(?:\*|(?:fonttbl|colortbl|stylesheet|info|pict|object|themedata|listtable|listoverridetable|rsidtbl|latentstyles|generator|filetbl|revtbl|xmlnstbl)\b)(?:[^{}]|\{[^{}]*\})*\}/g;

export function rtfToPlainText(rtf: string): string {
  // Drop data groups innermost-first: removing an outer group can expose or
  // complete a nested one on the next pass.
  let text = rtf;
  for (let pass = 0; pass < 5; pass++) {
    const next = text.replace(DESTINATION_GROUP, '');
    if (next === text) break;
    text = next;
  }
  // Structure: paragraphs, line breaks, tabs, non-breaking spaces.
  text = text
    .replace(/\\par[d]?(?![a-z])/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\~/g, '\u00a0');
  // Escapes: \uN (with its optional swallowed fallback char), \'hh hex, then
  // literal \\, \{, \} — braces park in placeholders so the final sweep of
  // grouping braces can't eat the ones that were escaped on purpose.
  text = text
    .replace(/\\u(-?\d+) ?\??/g, (_, dec: string) => {
      const code = (Number(dec) + 65536) % 65536;
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\([\\{}])/g, (_, c: string) =>
      c === '\\' ? '\\' : c === '{' ? '\u0001' : '\u0002',
    );
  // Remaining control words (with optional numeric parameter and the single
  // space that delimits them), stray ignorable stars, and grouping braces —
  // then restore the escaped-brace placeholders.
  text = text
    .replace(/\\\*?[a-z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/[\u0001\u0002]/g, (m) => (m === '\u0001' ? '{' : '}'));
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
