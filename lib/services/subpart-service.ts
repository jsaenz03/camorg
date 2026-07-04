/**
 * Subpart Service Implementation (Tauri SQLite)
 *
 * Manages autocomplete suggestions for subpart values per body part.
 * Drop-in replacement for the IndexedDB version.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SubpartSuggestion } from '@/types/subpart';
import type { BodyPart } from '@/types/body-part';
import type { ISubpartService } from '@/specs/001-role-you-are/contracts/subpart-service';
import { getDB } from '@/lib/db/database';
import { NotFoundError, ValidationError } from '@/lib/validators/errors';

function rowToSuggestion(row: Record<string, unknown>): SubpartSuggestion {
  return {
    id: row.id as string,
    bodyPart: row.body_part as BodyPart,
    subpart: row.subpart as string,
    displayText: row.display_text as string,
    usageCount: row.usage_count as number,
    lastUsedAt: new Date(row.last_used_at as number),
    clinicianId: (row.clinician_id as string) || '',
  };
}

export class SubpartService implements ISubpartService {
  async getSuggestionsForBodyPart(
    bodyPart: BodyPart,
    limit: number = 10
  ): Promise<SubpartSuggestion[]> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM subparts WHERE body_part = $1
       ORDER BY usage_count DESC, last_used_at DESC LIMIT $2`,
      [bodyPart, limit]
    );
    return rows.map(rowToSuggestion);
  }

  async searchSuggestions(
    bodyPart: BodyPart,
    searchTerm: string,
    limit: number = 5
  ): Promise<SubpartSuggestion[]> {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM subparts
        WHERE body_part = $1
          AND (LOWER(subpart) LIKE $2 OR LOWER(display_text) LIKE $2)`,
      [bodyPart, `%${normalizedSearch}%`]
    );
    const suggestions = rows.map(rowToSuggestion);

    // ponytail: "exact, then prefix, then usage" tiebreak is fiddly in SQL;
    // apply client-side on the small filtered set.
    suggestions.sort((a, b) => {
      const aExact = a.subpart === normalizedSearch;
      const bExact = b.subpart === normalizedSearch;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = a.subpart.startsWith(normalizedSearch);
      const bStarts = b.subpart.startsWith(normalizedSearch);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    });

    return suggestions.slice(0, limit);
  }

  /**
   * Records usage: insert-or-update on (bodyPart, normalized subpart).
   */
  async recordUsage(bodyPart: BodyPart, subpartText: string): Promise<SubpartSuggestion> {
    if (subpartText.length > 100) {
      throw new ValidationError('Subpart text exceeds 100 characters');
    }

    const normalizedSubpart = subpartText.trim().toLowerCase();
    const displayText = subpartText.trim();
    const nowMs = Date.now();
    const db = await getDB();

    // ponytail: ON CONFLICT upsert — SQLite >=3.24, Tauri bundles newer.
    // We bump usage_count and refresh display_text/last_used_at in one statement.
    await db.execute(
      `INSERT INTO subparts (id, body_part, subpart, display_text, usage_count, last_used_at, clinician_id)
       VALUES ($1, $2, $3, $4, 1, $5, '')
       ON CONFLICT(body_part, subpart) DO UPDATE SET
         usage_count = usage_count + 1,
         last_used_at = $5,
         display_text = $4`,
      [uuidv4(), bodyPart, normalizedSubpart, displayText, nowMs]
    );

    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM subparts WHERE body_part = $1 AND subpart = $2',
      [bodyPart, normalizedSubpart]
    );
    return rowToSuggestion(rows[0]);
  }

  async deleteSuggestion(id: string): Promise<void> {
    const db = await getDB();
    const rows = await db.select<{ id: string }[]>(
      'SELECT id FROM subparts WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Subpart suggestion not found: ${id}`);
    await db.execute('DELETE FROM subparts WHERE id = $1', [id]);
  }

  async getAllSuggestions(): Promise<SubpartSuggestion[]> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM subparts ORDER BY usage_count DESC, last_used_at DESC'
    );
    return rows.map(rowToSuggestion);
  }

  async mergeSuggestions(sourceId: string, targetId: string): Promise<SubpartSuggestion> {
    const db = await getDB();
    const srcRows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM subparts WHERE id = $1',
      [sourceId]
    );
    if (!srcRows.length) throw new NotFoundError(`Source suggestion not found: ${sourceId}`);
    const tgtRows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM subparts WHERE id = $1',
      [targetId]
    );
    if (!tgtRows.length) throw new NotFoundError(`Target suggestion not found: ${targetId}`);

    const source = rowToSuggestion(srcRows[0]);
    const target = rowToSuggestion(tgtRows[0]);

    if (source.bodyPart !== target.bodyPart) {
      throw new ValidationError(
        `Cannot merge suggestions from different body parts: ${source.bodyPart} vs ${target.bodyPart}`
      );
    }

    const mergedCount = target.usageCount + source.usageCount;
    const mergedLastUsed = Math.max(
      target.lastUsedAt.getTime(),
      source.lastUsedAt.getTime()
    );

    await db.execute(
      'UPDATE subparts SET usage_count = $1, last_used_at = $2 WHERE id = $3',
      [mergedCount, mergedLastUsed, targetId]
    );
    await db.execute('DELETE FROM subparts WHERE id = $1', [sourceId]);

    return { ...target, usageCount: mergedCount, lastUsedAt: new Date(mergedLastUsed) };
  }

  async clearSuggestionsForBodyPart(bodyPart: BodyPart): Promise<number> {
    const db = await getDB();
    const rows = await db.select<{ cnt: number }[]>(
      'SELECT COUNT(*) AS cnt FROM subparts WHERE body_part = $1',
      [bodyPart]
    );
    const count = rows[0]?.cnt ?? 0;
    await db.execute('DELETE FROM subparts WHERE body_part = $1', [bodyPart]);
    return count;
  }
}

// Export singleton instance
export const subpartService = new SubpartService();
