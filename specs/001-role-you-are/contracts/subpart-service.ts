/**
 * Subpart Service Contract
 *
 * Defines the interface for subpart autocomplete suggestion operations.
 * Manages the cache of previously used subpart values for each body part.
 */

import { SubpartSuggestion } from '@/types/subpart';
import { BodyPart } from '@/types/body-part';

export interface ISubpartService {
  /**
   * Gets autocomplete suggestions for a specific body part
   *
   * @param bodyPart - Body part to get suggestions for
   * @param limit - Maximum number of suggestions to return (default: 10)
   * @returns Promise resolving to array of SubpartSuggestions, sorted by usageCount DESC, lastUsedAt DESC
   * @throws Error if IndexedDB query fails
   *
   * Performance: Uses indexed query (bodyPart index)
   * Use case: Populate autocomplete dropdown when user selects body part
   */
  getSuggestionsForBodyPart(bodyPart: BodyPart, limit?: number): Promise<SubpartSuggestion[]>;

  /**
   * Searches subpart suggestions by partial text match
   *
   * @param bodyPart - Body part to search within
   * @param searchTerm - Partial text to match (case-insensitive)
   * @param limit - Maximum number of suggestions to return (default: 5)
   * @returns Promise resolving to array of matching SubpartSuggestions
   * @throws Error if IndexedDB query fails
   *
   * Use case: Filter autocomplete as user types
   */
  searchSuggestions(bodyPart: BodyPart, searchTerm: string, limit?: number): Promise<SubpartSuggestion[]>;

  /**
   * Records usage of a subpart (creates or updates suggestion)
   *
   * @param bodyPart - Body part the subpart belongs to
   * @param subpartText - Subpart text as entered by user
   * @returns Promise resolving to the created or updated SubpartSuggestion
   * @throws ValidationError if subpartText exceeds 100 characters
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - If suggestion exists: increments usageCount, updates lastUsedAt
   * - If suggestion is new: creates record with usageCount = 1
   *
   * Note: Automatically called by PhotoService.createPhoto and updatePhoto
   */
  recordUsage(bodyPart: BodyPart, subpartText: string): Promise<SubpartSuggestion>;

  /**
   * Deletes a subpart suggestion
   *
   * @param id - SubpartSuggestion UUID
   * @returns Promise resolving to void
   * @throws NotFoundError if suggestion does not exist
   * @throws Error if IndexedDB transaction fails
   *
   * Note: Does not affect existing photos with this subpart (data integrity)
   * Use case: Remove irrelevant or incorrect autocomplete suggestions
   */
  deleteSuggestion(id: string): Promise<void>;

  /**
   * Gets all suggestions across all body parts (admin view)
   *
   * @returns Promise resolving to array of all SubpartSuggestions
   * @throws Error if IndexedDB query fails
   *
   * Use case: Settings page to manage autocomplete suggestions
   */
  getAllSuggestions(): Promise<SubpartSuggestion[]>;

  /**
   * Merges duplicate suggestions (combines usage counts)
   *
   * @param sourceId - ID of suggestion to merge from (will be deleted)
   * @param targetId - ID of suggestion to merge into (usage count updated)
   * @returns Promise resolving to updated target SubpartSuggestion
   * @throws NotFoundError if either suggestion does not exist
   * @throws ValidationError if suggestions are for different body parts
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - target.usageCount += source.usageCount
   * - target.lastUsedAt = max(target.lastUsedAt, source.lastUsedAt)
   * - source record deleted
   *
   * Use case: Clean up typos or normalize variations (e.g., "left forearm" + "Left Forearm")
   */
  mergeSuggestions(sourceId: string, targetId: string): Promise<SubpartSuggestion>;

  /**
   * Clears all suggestions for a specific body part
   *
   * @param bodyPart - Body part to clear suggestions for
   * @returns Promise resolving to number of deleted suggestions
   * @throws Error if IndexedDB transaction fails
   *
   * Use case: Reset autocomplete for a body part
   */
  clearSuggestionsForBodyPart(bodyPart: BodyPart): Promise<number>;
}

/**
 * Error Types
 */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
