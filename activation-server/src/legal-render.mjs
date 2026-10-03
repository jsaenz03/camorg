/**
 * Renders the public legal documents (public/legal/*.md) into pages wearing
 * the camog-landing brand. The markdown files stay the single source of
 * truth — this renders whatever is in them at request time, so editing a
 * .md and deploying updates the page. No npm markdown dependency: the legal
 * docs use a deliberately small dialect (headings, flat lists, pipe tables,
 * bold/italic, hr) and everything else is escaped verbatim.
 */

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Inline markdown on already-escaped text: strong, then em (bold first so
// ** wins over *), then `code`. Links intentionally not supported: the legal
// sources carry plain-text URLs only.
function inline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function tableHtml(rows) {
  const cells = (line) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells); // rows[1] is the |---|---| rule
  const th = head.map((c) => `<th>${inline(esc(c))}</th>`).join('');
  const trs = body
    .map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="legal-table-scroll"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

export function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length + 1; // doc h1 -> page h2, ## -> h3
      out.push(`<h${level}>${inline(esc(heading[2].trim()))}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      out.push(tableHtml(rows));
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((t) => `<li>${inline(esc(t))}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      let first = 1;
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const m = lines[i].match(/^(\d+)\. /);
        if (items.length === 0) first = Number(m[1]);
        items.push(lines[i++].replace(/^\d+\. /, ''));
      }
      // Keep the document's own numbering if it ever starts past 1 — clause
      // references depend on it.
      const open = first === 1 ? '<ol>' : `<ol start="${first}">`;
      out.push(`${open}${items.map((t) => `<li>${inline(esc(t))}</li>`).join('')}</ol>`);
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|- |\d+\. |\|)/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${inline(esc(para.join(' ')))}</p>`);
  }
  return out.join('\n');
}

const FOOTER = `
  <footer class="site-footer">
    <div class="container">
      <img src="/logo.png" alt="Camog logo">
      <p>Camog by ClinicIQ Solutions. Wollongong NSW, Australia.</p>
      <nav class="footer-nav" aria-label="Footer">
        <a href="/">Downloads</a>
        <a href="/buy">Pricing and licences</a>
        <a href="/legal/terms-of-service.md">Terms</a>
        <a href="/legal/privacy-policy.md">Privacy policy</a>
        <a href="mailto:admin@cliniciq.com.au">Support</a>
      </nav>
      <p>Camog is an independent product of ClinicIQ Solutions. Patient photographs never leave your computer, and ClinicIQ Solutions has no access to them.</p>
    </div>
  </footer>`;

export function legalPageHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="Camog, clinical photo documentation for Australian clinics: ${esc(title)}">
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="preload" href="/fonts/oswald-variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/plexmono-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/brand.css">
</head>
<body>
  <header class="site-header">
    <div class="container header-row">
      <a class="brand" href="/"><img src="/logo.png" alt=""><span>Camog</span></a>
      <a class="header-link" href="/buy">Buy a licence</a>
    </div>
  </header>
  <main>
    <div class="container legal-wrap">
      ${bodyHtml}
    </div>
  </main>
  ${FOOTER}
</body>
</html>
`;
}

/** Render a legal .md file into a full branded page (used by worker.mjs). */
export function renderLegalDoc(md) {
  const html = markdownToHtml(md);
  // The doc's own h1 (its title) is pulled out: it becomes <title> and the
  // page-head; the effective-date line under it stays part of the body.
  const firstHeading = html.match(/^<h2>(.*)<\/h2>/);
  const title = firstHeading ? firstHeading[1].replaceAll(/<[^>]+>/g, '') : 'Legal';
  const body = firstHeading ? html.replace(firstHeading[0], '') : html;
  return legalPageHtml(title, `<header class="page-head"><h1>${firstHeading ? firstHeading[1] : esc(title)}</h1></header><div class="legal-body">${body}</div>`);
}
