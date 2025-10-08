/**
 * Subpart Service Implementation
 *
 * Manages autocomplete suggestions for subpart values per body part.
 * Implements ISubpartService interface from contracts/subpart-service.ts
 */

import { v4 as uuidv4 } from 'uuid';
import type { SubpartSuggestion } from '@/types/subpart';
import type { BodyPart } from '@/types/body-part';
import type { ISubpartService } from '@/specs/001-role-you-are/contracts/subpart-service';
import { getDB } from '@/lib/db/indexeddb';
import { STORES } from '@/lib/db/schema';
import { NotFoundError, ValidationError } from '@/lib/validators/errors';

export class SubpartService implements ISubpartService {
  /**
   * Gets autocomplete suggestions for a specific body part
   */
  async getSuggestionsForBodyPart(
    bodyPart: BodyPart,
    limit: number = 10
  ): Promise<SubpartSuggestion[]> {
    const db = await getDB();
    let suggestions = await db.getAllFromIndex(STORES.SUBPARTS, 'bodyPart', bodyPart);

    // Sort by usageCount DESC, then lastUsedAt DESC
    suggestions.sort((a, b) => {
      if (a.usageCount !== b.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    });

    // Limit results
    return suggestions.slice(0, limit);
  }

  /**
   * Searches subpart suggestions by partial text match
   */
  async searchSuggestions(
    bodyPart: BodyPart,
    searchTerm: string,
    limit: number = 5
  ): Promise<SubpartSuggestion[]> {
    const db = await getDB();
    const normalizedSearch = searchTerm.trim().toLowerCase();

    let suggestions = await db.getAllFromIndex(STORES.SUBPARTS, 'bodyPart', bodyPart);

    // Filter by search term
    suggestions = suggestions.filter((s) =>
      s.subpart.includes(normalizedSearch) || s.displayText.toLowerCase().includes(normalizedSearch)
    );

    // Sort by relevance (exact match first, then starts with, then usage count)
    suggestions.sort((a, b) => {
      const aExact = a.subpart === normalizedSearch;
      const bExact = b.subpart === normalizedSearch;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = a.subpart.startsWith(normalizedSearch);
      const bStarts = b.subpart.startsWith(normalizedSearch);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // Fallback to usage count
      if (a.usageCount !== b.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    });

    // Limit results
    return suggestions.slice(0, limit);
  }

  /**
   * Records usage of a subpart (creates or updates suggestion)
   */
  async recordUsage(bodyPart: BodyPart, subpartText: string): Promise<SubpartSuggestion> {
    // Validate length
    if (subpartText.length > 100) {
      throw new ValidationError('Subpart text exceeds 100 characters');
    }

    const db = await getDB();
    const normalizedSubpart = subpartText.trim().toLowerCase();

    // Check if suggestion already exists
    const existing = await db.getFromIndex(
      STORES.SUBPARTS,
      'bodyPart_subpart',
      [bodyPart, normalizedSubpart]
    );

    const now = new Date();

    if (existing) {
      // Update existing suggestion
      const updated: SubpartSuggestion = {
        ...existing,
        usageCount: existing.usageCount + 1,
        lastUsedAt: now,
        displayText: subpartText.trim(), // Update display text to latest casing
      };

      await db.put(STORES.SUBPARTS, updated);
      return updated;
    } else {
      // Create new suggestion
      const newSuggestion: SubpartSuggestion = {
        id: uuidv4(),
        bodyPart,
        subpart: normalizedSubpart,
        displayText: subpartText.trim(),
        usageCount: 1,
        lastUsedAt: now,
        clinicianId: '', // Will be set by auth context in real implementation
      };

      await db.add(STORES.SUBPARTS, newSuggestion);
      return newSuggestion;
    }
  }

  /**
   * Deletes a subpart suggestion
   */
  async deleteSuggestion(id: string): Promise<void> {
    const db = await getDB();
    const suggestion = await db.get(STORES.SUBPARTS, id);

    if (!suggestion) {
      throw new NotFoundError(`Subpart suggestion not found: ${id}`);
    }

    await db.delete(STORES.SUBPARTS, id);
  }

  /**
   * Gets all suggestions across all body parts
   */
  async getAllSuggestions(): Promise<SubpartSuggestion[]> {
    const db = await getDB();
    const suggestions = await db.getAll(STORES.SUBPARTS);

    // Sort by usage count DESC
    suggestions.sort((a, b) => {
      if (a.usageCount !== b.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    });

    return suggestions;
  }

  /**
   * Merges duplicate suggestions (combines usage counts)
   */
  async mergeSuggestions(sourceId: string, targetId: string): Promise<SubpartSuggestion> {
    const db = await getDB();

    const source = await db.get(STORES.SUBPARTS, sourceId);
    const target = await db.get(STORES.SUBPARTS, targetId);

    if (!source) {
      throw new NotFoundError(`Source suggestion not found: ${sourceId}`);
    }

    if (!target) {
      throw new NotFoundError(`Target suggestion not found: ${targetId}`);
    }

    if (source.bodyPart !== target.bodyPart) {
      throw new ValidationError(
        `Cannot merge suggestions from different body parts: ${source.bodyPart} vs ${target.bodyPart}`
      );
    }

    // Update target
    const merged: SubpartSuggestion = {
      ...target,
      usageCount: target.usageCount + source.usageCount,
      lastUsedAt: new Date(
        Math.max(target.lastUsedAt.getTime(), source.lastUsedAt.getTime())
      ),
    };

    // Use transaction to ensure atomicity
    const tx = db.transaction([STORES.SUBPARTS], 'readwrite');
    await tx.objectStore(STORES.SUBPARTS).put(merged);
    await tx.objectStore(STORES.SUBPARTS).delete(sourceId);
    await tx.done;

    return merged;
  }

  /**
   * Clears all suggestions for a specific body part
   */
  async clearSuggestionsForBodyPart(bodyPart: BodyPart): Promise<number> {
    const db = await getDB();
    const suggestions = await db.getAllFromIndex(STORES.SUBPARTS, 'bodyPart', bodyPart);

    const tx = db.transaction([STORES.SUBPARTS], 'readwrite');
    for (const suggestion of suggestions) {
      await tx.objectStore(STORES.SUBPARTS).delete(suggestion.id);
    }
    await tx.done;

    return suggestions.length;
  }
}

// Export singleton instance
export const subpartService = new SubpartService();
