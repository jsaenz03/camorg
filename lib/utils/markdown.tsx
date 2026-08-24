/**
 * Minimal markdown renderer for the shipped legal documents
 * (public/legal/*.md): #/## headings, --- rules, > blockquotes (rendered as
 * callouts — in these documents they carry the review notice), bullet
 * lists, paragraphs, and **bold** / *italic* / `code` inline.
 *
 * Deliberately tiny: the content is trusted local files, and it produces
 * React nodes — never injected HTML. Extend it (links, nested lists,
 * tables) before pointing it at arbitrary markdown.
 */

import type { ReactNode } from 'react';

/** Tokenise one line of inline markdown into styled React nodes. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split('\n');
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let quote: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    nodes.push(
      <p key={key++} className="mt-4 leading-relaxed first:mt-0">
        {renderInline(paragraph.join(' '))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    nodes.push(
      <ul key={key++} className="mt-4 list-disc space-y-1.5 pl-6 leading-relaxed">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    nodes.push(
      <div
        key={key++}
        className="mt-4 space-y-2 rounded-r-md border-l-2 border-amber-500/60 bg-amber-500/5 p-4 text-sm leading-relaxed"
      >
        {quote.map((line, i) => (
          <p key={i}>{renderInline(line)}</p>
        ))}
      </div>,
    );
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (/^---\s*$/.test(line)) {
      flushAll();
      nodes.push(<hr key={key++} className="my-8 border-t" />);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        nodes.push(
          <h2 key={key++} className="text-xl font-semibold tracking-tight">
            {renderInline(text)}
          </h2>,
        );
      } else if (level === 2) {
        nodes.push(
          <h3 key={key++} className="mt-8 text-lg font-semibold tracking-tight">
            {renderInline(text)}
          </h3>,
        );
      } else {
        nodes.push(
          <h4 key={key++} className="mt-6 text-base font-semibold">
            {renderInline(text)}
          </h4>,
        );
      }
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph();
      flushList();
      quote.push(line.slice(2));
      continue;
    }
    if (line.startsWith('- ')) {
      flushParagraph();
      flushQuote();
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return nodes;
}
