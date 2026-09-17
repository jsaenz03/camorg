/**
 * Note Template Service (Tauri SQLite)
 *
 * Per-clinician quick-text phrases for clinical notes: a starter set seeded
 * on first use, click-to-insert from the notes field (usage-ranked), and
 * optional type-a-shortcut expansions. Every method scopes to clinicianId —
 * lists are never shared between clinicians.
 */

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type { NoteTemplate, NoteTemplateCreate, NoteTemplateUpdate } from '@/types/note-template';
import {
  noteTemplateCreateSchema,
  noteTemplateUpdateSchema,
} from '@/lib/validators/schemas';
import { getDB } from '@/lib/db/database';
import { NotFoundError, ValidationError } from '@/lib/validators/errors';
import { ensureWritable } from '@/lib/licence/guard';
import { STARTER_NAMESPACE, STARTER_TEMPLATES } from '@/lib/utils/note-template-starters';

/** Stable row id for a starter template: the same slug always produces the
 *  same id for a clinician, so seeding and restoring are idempotent even when
 *  two first-lists race (the duplicate insert loses to OR REPLACE). */
function starterId(clinicianId: string, slug: string): string {
  return uuidv5(`${clinicianId}:${slug}`, STARTER_NAMESPACE);
}

/** SQLite throws this wording when the partial unique index bites. */
function mapUniqueViolation(err: unknown): never {
  if (err instanceof Error && /UNIQUE/i.test(err.message)) {
    throw new ValidationError('That shortcut is already used by another template');
  }
  throw err instanceof Error ? err : new ValidationError(String(err));
}

function rowToTemplate(row: Record<string, unknown>): NoteTemplate {
  return {
    id: row.id as string,
    clinicianId: row.clinician_id as string,
    title: row.title as string,
    body: row.body as string,
    shortcut: (row.shortcut as string) || null,
    usageCount: row.usage_count as number,
    lastUsedAt: row.last_used_at != null ? new Date(row.last_used_at as number) : null,
    isDeleted: row.is_deleted === 1,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
  };
}

/** '' / whitespace shortcuts are stored as NULL (not expandable). */
function normaliseShortcut(shortcut: string | null | undefined): string | null {
  const trimmed = shortcut?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export class NoteTemplateService {
  /** Seed the starter set for a clinician who has never had any template
   *  (count includes soft-deleted rows, so a deliberate "deleted them all"
   *  is never silently undone; restoreStarters covers that case). */
  private async ensureSeeded(clinicianId: string): Promise<void> {
    const db = await getDB();
    const rows = await db.select<{ cnt: number }[]>(
      'SELECT COUNT(*) AS cnt FROM note_templates WHERE clinician_id = $1',
      [clinicianId],
    );
    if ((rows[0]?.cnt ?? 0) > 0) return;
    await this.insertStarters(db, clinicianId);
  }

  private async insertStarters(
    db: Awaited<ReturnType<typeof getDB>>,
    clinicianId: string,
  ): Promise<void> {
    const nowMs = Date.now();
    for (const template of STARTER_TEMPLATES) {
      await db.execute(
        `INSERT OR REPLACE INTO note_templates
           (id, clinician_id, title, body, shortcut, usage_count, last_used_at, is_deleted, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 0, NULL, 0, $6, $6)`,
        [
          starterId(clinicianId, template.slug),
          clinicianId,
          template.title,
          template.body,
          template.shortcut ?? null,
          nowMs,
        ],
      );
    }
  }

  async listTemplates(clinicianId: string): Promise<NoteTemplate[]> {
    // First-list seeding. A read-only licence can't write — seeding is
    // skipped and the picker falls back to the starter set client-side.
    try {
      await ensureWritable();
      await this.ensureSeeded(clinicianId);
    } catch {
      // Seeding is best-effort; listing always proceeds.
    }
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM note_templates
        WHERE clinician_id = $1 AND is_deleted = 0
        ORDER BY usage_count DESC, title COLLATE NOCASE ASC`,
      [clinicianId],
    );
    return rows.map(rowToTemplate);
  }

  async createTemplate(clinicianId: string, input: NoteTemplateCreate): Promise<NoteTemplate> {
    await ensureWritable();
    const validated = noteTemplateCreateSchema.parse(input);
    const nowMs = Date.now();
    const id = uuidv4();
    const db = await getDB();
    try {
      await db.execute(
        `INSERT INTO note_templates
           (id, clinician_id, title, body, shortcut, usage_count, last_used_at, is_deleted, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 0, NULL, 0, $6, $6)`,
        [
          id,
          clinicianId,
          validated.title,
          validated.body,
          normaliseShortcut(validated.shortcut),
          nowMs,
        ],
      );
    } catch (err) {
      mapUniqueViolation(err);
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM note_templates WHERE id = $1',
      [id],
    );
    return rowToTemplate(rows[0]);
  }

  async updateTemplate(
    clinicianId: string,
    id: string,
    patch: NoteTemplateUpdate,
  ): Promise<NoteTemplate> {
    await ensureWritable();
    const validated = noteTemplateUpdateSchema.parse(patch);
    const db = await getDB();
    const existing = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM note_templates WHERE id = $1 AND clinician_id = $2 AND is_deleted = 0',
      [id, clinicianId],
    );
    if (!existing.length) throw new NotFoundError(`Note template not found: ${id}`);
    const current = rowToTemplate(existing[0]);
    try {
      await db.execute(
        'UPDATE note_templates SET title = $1, body = $2, shortcut = $3, updated_at = $4 WHERE id = $5',
        [
          validated.title ?? current.title,
          validated.body ?? current.body,
          normaliseShortcut(validated.shortcut !== undefined ? validated.shortcut : current.shortcut),
          Date.now(),
          id,
        ],
      );
    } catch (err) {
      mapUniqueViolation(err);
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM note_templates WHERE id = $1',
      [id],
    );
    return rowToTemplate(rows[0]);
  }

  async deleteTemplate(clinicianId: string, id: string): Promise<void> {
    await ensureWritable();
    const db = await getDB();
    const result = await db.execute(
      'UPDATE note_templates SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND clinician_id = $3 AND is_deleted = 0',
      [Date.now(), id, clinicianId],
    );
    if (result.rowsAffected === 0) {
      throw new NotFoundError(`Note template not found: ${id}`);
    }
  }

  /** Bring back the starter set (used when the clinician's list is empty). */
  async restoreStarters(clinicianId: string): Promise<void> {
    await ensureWritable();
    const db = await getDB();
    await this.insertStarters(db, clinicianId);
  }

  /** Usage bump on insert. Best-effort: the note text is already in the
   *  field, so a failure here must never cost the clinician their insertion. */
  async recordUsage(clinicianId: string, id: string): Promise<void> {
    const db = await getDB();
    await db.execute(
      'UPDATE note_templates SET usage_count = usage_count + 1, last_used_at = $1 WHERE id = $2 AND clinician_id = $3',
      [Date.now(), id, clinicianId],
    );
  }
}

// Export singleton instance
export const noteTemplateService = new NoteTemplateService();
