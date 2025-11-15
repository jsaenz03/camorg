/**
 * Body Part Initializer Service
 * Handles initialization of default body parts for new patients
 */

import { CreateBodyPartRequest } from '../models/body-part';
import { BodyPartService } from './body-part-service';
import { DEFAULT_BODY_PARTS, BodyPartTemplate } from '../data/default-body-parts';

export class BodyPartInitializer {
  private bodyPartService: BodyPartService;

  constructor(bodyPartService: BodyPartService) {
    this.bodyPartService = bodyPartService;
  }

  /**
   * Initialize default body parts for a patient
   * Returns the count of body parts created
   */
  async initializeBodyPartsForPatient(patientId: string): Promise<number> {
    try {
      console.log(`Initializing default body parts for patient: ${patientId}`);

      let createdCount = 0;

      // Create body parts recursively
      for (const template of DEFAULT_BODY_PARTS) {
        const count = await this.createBodyPartFromTemplate(
          patientId,
          template,
          null // No parent for root level
        );
        createdCount += count;
      }

      console.log(`Successfully initialized ${createdCount} body parts for patient ${patientId}`);
      return createdCount;
    } catch (error) {
      console.error('Failed to initialize body parts for patient:', error);
      throw new Error(`Failed to initialize body parts: ${error}`);
    }
  }

  /**
   * Create a body part and its children from a template
   * Returns the count of body parts created (including children)
   */
  private async createBodyPartFromTemplate(
    patientId: string,
    template: BodyPartTemplate,
    parentId: string | null
  ): Promise<number> {
    // Create the body part
    const request: CreateBodyPartRequest = {
      patientId,
      name: template.name,
      displayOrder: template.displayOrder,
      parentId: parentId ?? undefined,
    };

    const bodyPart = await this.bodyPartService.createBodyPart(request);
    let count = 1;

    // Create children if they exist
    if (template.children && template.children.length > 0) {
      for (const childTemplate of template.children) {
        const childCount = await this.createBodyPartFromTemplate(
          patientId,
          childTemplate,
          bodyPart.id
        );
        count += childCount;
      }
    }

    return count;
  }

  /**
   * Check if a patient already has body parts initialized
   */
  async hasBodyPartsInitialized(patientId: string): Promise<boolean> {
    try {
      const rootBodyParts = await this.bodyPartService.getRootBodyParts(patientId);
      return rootBodyParts.length > 0;
    } catch (error) {
      console.error('Failed to check if body parts are initialized:', error);
      return false;
    }
  }

  /**
   * Initialize body parts only if they haven't been initialized yet
   */
  async ensureBodyPartsInitialized(patientId: string): Promise<boolean> {
    const hasBodyParts = await this.hasBodyPartsInitialized(patientId);

    if (hasBodyParts) {
      console.log(`Patient ${patientId} already has body parts initialized`);
      return false;
    }

    await this.initializeBodyPartsForPatient(patientId);
    return true;
  }

  /**
   * Re-initialize body parts (warning: deletes existing body parts)
   * Only use this if the patient has no photos
   */
  async reinitializeBodyParts(patientId: string): Promise<number> {
    try {
      console.log(`Re-initializing body parts for patient: ${patientId}`);

      // Get all existing body parts
      const rootBodyParts = await this.bodyPartService.getRootBodyParts(patientId);

      // Delete all root body parts (this will cascade delete children)
      for (const bodyPart of rootBodyParts) {
        try {
          await this.bodyPartService.deleteBodyPart(bodyPart.id);
        } catch (error) {
          console.error(`Failed to delete body part ${bodyPart.id}:`, error);
          throw new Error(
            'Cannot reinitialize body parts: some body parts contain photos. Delete photos first.'
          );
        }
      }

      // Initialize new body parts
      return await this.initializeBodyPartsForPatient(patientId);
    } catch (error) {
      console.error('Failed to reinitialize body parts:', error);
      throw error;
    }
  }

  /**
   * Get body part initialization statistics
   */
  getInitializationStats(): {
    totalBodyParts: number;
    rootCategories: number;
    maxDepth: number;
  } {
    let totalBodyParts = 0;
    let maxDepth = 0;

    function countRecursive(parts: BodyPartTemplate[], depth: number): void {
      maxDepth = Math.max(maxDepth, depth);
      parts.forEach(part => {
        totalBodyParts++;
        if (part.children) {
          countRecursive(part.children, depth + 1);
        }
      });
    }

    countRecursive(DEFAULT_BODY_PARTS, 0);

    return {
      totalBodyParts,
      rootCategories: DEFAULT_BODY_PARTS.length,
      maxDepth,
    };
  }
}

// Create and export singleton instance
export const bodyPartInitializer = new BodyPartInitializer(
  new BodyPartService()
);
