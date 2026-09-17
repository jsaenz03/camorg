/**
 * Note templates: a clinician's quick-text phrases for clinical notes.
 *
 * Per clinician by design — one person's phrasing never lands in a
 * colleague's picker. A template may optionally carry a `shortcut`, which
 * the clinician can type into a notes field followed by Space to expand
 * the body in place (see lib/utils/text-expansion).
 */

export interface NoteTemplate {
  id: string; // UUID v4, primary key
  clinicianId: string; // Owner; rows are always scoped to this clinician
  title: string; // Short label in the picker
  body: string; // Text inserted into the note; may contain tokens
  shortcut: string | null; // e.g. "ncp"; null = not expandable by typing
  usageCount: number; // Bumped on each insert; sorts the picker
  lastUsedAt: Date | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteTemplateCreate {
  title: string;
  body: string;
  shortcut?: string | null;
}

export interface NoteTemplateUpdate {
  title?: string;
  body?: string;
  shortcut?: string | null;
}
