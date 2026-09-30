'use client';

/**
 * EmailComposeDialog Component
 *
 * Composer for the case-report email handoff: To, subject and an HTML
 * message with a Preview/Write toggle. The draft state lives in the parent
 * page so switching tabs or cancelling keeps the clinician's edits.
 *
 * The dialog opens on Preview — the rendered email — because most users
 * don't read raw HTML; the Write tab is there for clinicians who want to
 * edit the source. The preview renders the exact HTML the mail client will
 * receive inside a sandboxed iframe. The sandbox keeps allow-same-origin:
 * WebKit (the macOS app's WKWebView) refuses to load srcdoc documents in
 * opaque-origin frames entirely, while scripts stay blocked by the absent
 * allow-scripts flag, which is the boundary that matters — clinician-
 * authored HTML cannot execute, so it cannot touch the app.
 *
 * Confirming hands the wording to email_case_report (Rust) exactly as for
 * the one-click flow: PDF rendered locally and handed over with the draft,
 * nothing sent by Camog.
 */

import { useState } from 'react';
import { Code2, Eye, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { EmailDraft } from '@/lib/utils/report-email';

interface EmailComposeDialogProps {
  draft: EmailDraft;
  onDraftChange: (draft: EmailDraft) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the handoff with the current draft; resolves on success. */
  onSend: (draft: EmailDraft) => void;
  isSending: boolean;
  /** Windows MAPI/mailto bodies are plain text (.eml keeps HTML) — the
   *  helper copy says so. */
  platform: 'windows' | 'macos';
}

export function EmailComposeDialog({
  draft,
  onDraftChange,
  open,
  onOpenChange,
  onSend,
  isSending,
  platform,
}: EmailComposeDialogProps) {
  // Preview is the default view: the dialog should show the email as the
  // patient's mail app will render it, not the HTML source.
  const [tab, setTab] = useState<'write' | 'preview'>('preview');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        {/* A form so Enter — from To or Subject — opens the draft, matching
            the app's other dialogs. The textarea keeps Enter as a newline. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!isSending) onSend(draft);
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Email case report</DialogTitle>
            <DialogDescription>
              Edit the message that opens in your email app alongside the
              report PDF. Nothing is sent until you send it from your own
              email app.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-to">To</Label>
              <Input
                id="email-to"
                type="email"
                inputMode="email"
                value={draft.recipient}
                onChange={(e) => onDraftChange({ ...draft, recipient: e.target.value })}
                disabled={isSending}
                placeholder="name@example.com"
              />
              <p className="text-sm text-muted-foreground">
                Leave blank to add the recipient in your email app.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                type="text"
                value={draft.subject}
                onChange={(e) => onDraftChange({ ...draft, subject: e.target.value })}
                disabled={isSending}
              />
            </div>

            <div className="space-y-2">
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'write' | 'preview')}>
                <div className="flex items-center justify-between gap-2">
                  {/* Points at the Write textarea; a dangling reference while
                      Preview is mounted is harmless, and the association
                      holds whenever the textarea exists. */}
                  <Label htmlFor="email-body">Message</Label>
                  <TabsList>
                    <TabsTrigger value="preview" disabled={isSending}>
                      <Eye className="size-4" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger value="write" disabled={isSending}>
                      <Code2 className="size-4" />
                      Write
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="preview" className="mt-0">
                  {/* Sandboxed iframe (scripts blocked): the draft is
                      clinician-authored HTML and must never execute in the
                      app. allow-same-origin is required for WebKit to load
                      srcdoc at all — see the component comment. The white
                      ground reads like a mail client; a themed template
                      paints its own background over it. */}
                  <div
                    role="region"
                    aria-label="Email preview"
                    className="h-64 overflow-hidden rounded-md border bg-white sm:h-72"
                  >
                    {draft.bodyHtml.trim() ? (
                      <iframe
                        title="Email preview"
                        sandbox="allow-same-origin"
                        srcDoc={draft.bodyHtml}
                        className="h-full w-full border-0 bg-white"
                      />
                    ) : (
                      <p className="p-4 text-sm text-zinc-500">
                        Nothing to preview yet — write a message first.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="write" className="mt-0">
                  <Textarea
                    id="email-body"
                    value={draft.bodyHtml}
                    onChange={(e) => onDraftChange({ ...draft, bodyHtml: e.target.value })}
                    disabled={isSending}
                    spellCheck={false}
                    aria-describedby="email-body-hint"
                    className="min-h-56 max-h-[50vh] resize-y pb-4 font-mono text-xs leading-relaxed"
                  />
                  <p id="email-body-hint" className="text-sm text-muted-foreground">
                    {platform === 'windows'
                      ? 'HTML message. Most Windows email apps open it with the formatting and the PDF attached; if yours shows plain text, the PDF keeps the formatting.'
                      : 'HTML message — Preview shows it as your mail app will render it.'}
                  </p>
                </TabsContent>
              </Tabs>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSending}>
              {isSending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              Open email draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
