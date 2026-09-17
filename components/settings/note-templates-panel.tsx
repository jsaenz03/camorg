'use client';

/**
 * Settings → Templates: the signed-in clinician's quick-text templates for
 * clinical notes, plus the optional shortcuts that expand them while typing.
 * Per clinician by design — one person's phrasing never lands in a
 * colleague's picker.
 */

import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, PenLine, Plus, RotateCcw, Trash2 } from 'lucide-react';

import type { NoteTemplate } from '@/types/note-template';
import {
  noteTemplateCreateSchema,
  type NoteTemplateCreateInput,
} from '@/lib/validators/schemas';
import { noteTemplateService } from '@/lib/services/note-template-service';
import { useAuth } from '@/lib/auth/auth-context';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const emptyForm: NoteTemplateCreateInput = {
  title: '',
  body: '',
  shortcut: '',
};

export function NoteTemplatesPanel() {
  const { clinician } = useAuth();
  const clinicianId = clinician?.id ?? '';
  const [templates, setTemplates] = useState<NoteTemplate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NoteTemplate | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const form = useForm<NoteTemplateCreateInput>({
    resolver: zodResolver(noteTemplateCreateSchema),
    defaultValues: emptyForm,
  });

  const refresh = useCallback(async () => {
    if (!clinicianId) return;
    try {
      setTemplates(await noteTemplateService.listTemplates(clinicianId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    }
  }, [clinicianId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openNew() {
    setEditing(null);
    form.reset(emptyForm);
    setOpen(true);
  }

  function openEdit(template: NoteTemplate) {
    setEditing(template);
    form.reset({
      title: template.title,
      body: template.body,
      shortcut: template.shortcut ?? '',
    });
    setOpen(true);
  }

  async function onSubmit(values: NoteTemplateCreateInput) {
    try {
      if (editing) {
        await noteTemplateService.updateTemplate(clinicianId, editing.id, values);
        toast.success('Template updated');
      } else {
        await noteTemplateService.createTemplate(clinicianId, values);
        toast.success('Template added');
      }
      setOpen(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function remove(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    try {
      await noteTemplateService.deleteTemplate(clinicianId, id);
      toast.success('Template removed');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function restoreStarters() {
    try {
      await noteTemplateService.restoreStarters(clinicianId);
      toast.success('Starter templates restored');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed');
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Note templates</CardTitle>
          <CardDescription>
            Quick-text phrases for clinical notes — yours only, not shared with
            other clinicians. A template with a shortcut expands when you type
            the shortcut then Space in a notes field.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 size-4" /> New
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {templates === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : templates.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No templates yet. Add your own, or bring back the starter set.
            </p>
            <Button variant="outline" size="sm" onClick={restoreStarters}>
              <RotateCcw className="mr-1 size-4" /> Restore starter templates
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{template.title}</span>
                    {template.shortcut && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {template.shortcut}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {template.body}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openEdit(template)}>
                  <PenLine className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={confirmId === template.id ? 'text-destructive' : undefined}
                  onClick={() => remove(template.id)}
                >
                  <Trash2 className="size-4" />
                  {confirmId === template.id ? 'Confirm' : null}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>
              Inserted from the “Quick text” menu on any clinical notes field.
              Tokens {'{date}'}, {'{patient}'} and {'{bodypart}'} fill in at
              insertion.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. No change" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shortcut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shortcut (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. ncp"
                        className="font-mono"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Type this in a notes field then press Space to insert the
                      template. 2–16 letters, numbers, hyphens or underscores.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template text</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g. No change since the previous photo — lesion stable in size, shape and colour."
                        className="min-h-24 resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  {editing ? 'Save changes' : 'Add template'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
