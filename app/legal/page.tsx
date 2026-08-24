'use client';

/**
 * Legal page — Terms of Service + Privacy Policy.
 *
 * Renders the markdown sources shipped in /public/legal (copies of legal/).
 * Reachable without signing in (no dashboard gate). Reading layout follows
 * long-form document guidance: ~65ch measure (max-w-prose), 16px relaxed
 * body, per-document anchors with scroll offset, and the review notice
 * styled as a callout.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { renderMarkdown } from '@/lib/utils/markdown';

interface LegalDoc {
  title: string;
  anchor: string;
  path: string;
}

const DOCS: LegalDoc[] = [
  { title: 'Terms of Service', anchor: 'terms-of-service', path: '/legal/terms-of-service.md' },
  { title: 'Privacy Policy', anchor: 'privacy-policy', path: '/legal/privacy-policy.md' },
];

export default function LegalPage() {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all(DOCS.map((d) => fetch(d.path).then((r) => r.text())))
      .then((results) => {
        if (!mounted) return;
        const map: Record<string, string> = {};
        DOCS.forEach((d, i) => (map[d.path] = results[i]));
        setTexts(map);
      })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Legal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Terms of Service and Privacy Policy for Camog.
          </p>
          <nav aria-label="On this page" className="mt-3 flex gap-3 text-sm">
            {DOCS.map((doc) => (
              <a
                key={doc.anchor}
                href={`#${doc.anchor}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {doc.title}
              </a>
            ))}
          </nav>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm">
            Couldn’t load the legal documents: {error}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {DOCS.map((doc) => (
            <Card key={doc.path} id={doc.anchor} className="scroll-mt-6">
              {/* max-w-prose keeps body text at a ~65-character measure. */}
              <CardContent className="max-w-prose p-6 text-base md:p-8">
                <span className="sr-only">{doc.title}</span>
                {texts[doc.path] ? (
                  renderMarkdown(texts[doc.path])
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-1/2" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
