import { BodyPart } from './body-part';

/**
 * Autocomplete cache for previously used subpart values per body part
 */
export interface SubpartSuggestion {
  id: string; // UUID v4, primary key
  bodyPart: BodyPart; // Which body part this subpart applies to
  subpart: string; // The subpart text (normalized: trimmed, lowercase)
  displayText: string; // Original case for display
  usageCount: number; // How many times this subpart has been used
  lastUsedAt: Date; // Most recent usage timestamp
  clinicianId: string; // Who first created this subpart
}
