/**
 * BodyPartService implementation with hierarchy management
 * Manages body part categories with hierarchical structure
 */

import {
  BodyPartCategory,
  CreateBodyPartRequest,
  UpdateBodyPartRequest,
  ReorderRequest,
  BodyPartHierarchy,
  BodyPartValidator,
  BodyPartFactory,
  BodyPartHierarchyUtils,
  BodyPartNotFoundError,
  BodyPartValidationError,
  BodyPartHasPhotosError,
  CircularReferenceError,
} from '../models/body-part';
import { databaseService } from './database-service';

export class BodyPartService {
  /**
   * Create a new body part category
   */
  async createBodyPart(request: CreateBodyPartRequest): Promise<BodyPartCategory> {
    // Validate request
    const validationErrors = BodyPartValidator.validateCreateRequest(request);
    if (validationErrors.length > 0) {
      throw new BodyPartValidationError('createBodyPart', validationErrors.join(', '));
    }

    try {
      const db = await databaseService.getDatabase();

      // Get parent level if parentId is provided
      let parentLevel = -1;
      if (request.parentId) {
        const parent = await db.bodyPartCategories.get(request.parentId);
        if (!parent) {
          throw new BodyPartValidationError('createBodyPart', 'Parent category not found');
        }
        parentLevel = parent.level;

        // Validate hierarchy level
        const levelErrors = BodyPartValidator.validateHierarchyLevel(parentLevel + 1);
        if (levelErrors.length > 0) {
          throw new BodyPartValidationError('createBodyPart', levelErrors.join(', '));
        }
      }

      // Create body part instance
      const bodyPart = BodyPartFactory.create(request, parentLevel);

      await db.bodyPartCategories.add(bodyPart);

      console.log(`Body part created: ${bodyPart.id}`);
      return bodyPart;
    } catch (error) {
      if (error instanceof BodyPartValidationError) {
        throw error;
      }
      console.error('Failed to create body part:', error);
      throw new BodyPartValidationError('createBodyPart', 'Failed to save body part to database');
    }
  }

  /**
   * Update existing body part category
   */
  async updateBodyPart(id: string, request: UpdateBodyPartRequest): Promise<BodyPartCategory> {
    // Validate request
    const validationErrors = BodyPartValidator.validateUpdateRequest(request);
    if (validationErrors.length > 0) {
      throw new BodyPartValidationError('updateBodyPart', validationErrors.join(', '));
    }

    try {
      const db = await databaseService.getDatabase();

      // Get existing body part
      const existingBodyPart = await db.bodyPartCategories.get(id);
      if (!existingBodyPart) {
        throw new BodyPartNotFoundError(id);
      }

      // Update body part
      const updatedBodyPart = BodyPartFactory.update(existingBodyPart, request);
      await db.bodyPartCategories.put(updatedBodyPart);

      console.log(`Body part updated: ${id}`);
      return updatedBodyPart;
    } catch (error) {
      if (error instanceof BodyPartNotFoundError || error instanceof BodyPartValidationError) {
        throw error;
      }
      console.error('Failed to update body part:', error);
      throw new BodyPartValidationError('updateBodyPart', 'Failed to update body part in database');
    }
  }

  /**
   * Get body part category by ID
   */
  async getBodyPart(id: string): Promise<BodyPartCategory | null> {
    try {
      const db = await databaseService.getDatabase();
      const bodyPart = await db.bodyPartCategories.get(id);
      return bodyPart || null;
    } catch (error) {
      console.error('Failed to get body part:', error);
      return null;
    }
  }

  /**
   * Get all body part categories for a patient as hierarchical tree
   */
  async getBodyPartsForPatient(patientId: string): Promise<BodyPartHierarchy> {
    try {
      const db = await databaseService.getDatabase();
      const bodyParts = await db.bodyPartCategories
        .where('patientId')
        .equals(patientId)
        .sortBy('displayOrder');

      return BodyPartHierarchyUtils.buildHierarchy(bodyParts);
    } catch (error) {
      console.error('Failed to get body parts for patient:', error);
      return {};
    }
  }

  /**
   * Get top-level body part categories for a patient
   */
  async getRootBodyParts(patientId: string): Promise<BodyPartCategory[]> {
    try {
      const db = await databaseService.getDatabase();
      const rootBodyParts = await db.bodyPartCategories
        .where(['patientId', 'level'])
        .equals([patientId, 0])
        .sortBy('displayOrder');

      return rootBodyParts;
    } catch (error) {
      console.error('Failed to get root body parts:', error);
      return [];
    }
  }

  /**
   * Get child categories of a specific body part
   */
  async getChildBodyParts(parentId: string): Promise<BodyPartCategory[]> {
    try {
      const db = await databaseService.getDatabase();
      const children = await db.bodyPartCategories
        .where('parentId')
        .equals(parentId)
        .sortBy('displayOrder');

      return children;
    } catch (error) {
      console.error('Failed to get child body parts:', error);
      return [];
    }
  }

  /**
   * Delete body part category and all children
   */
  async deleteBodyPart(id: string): Promise<boolean> {
    try {
      const db = await databaseService.getDatabase();

      // Check if body part exists
      const bodyPart = await db.bodyPartCategories.get(id);
      if (!bodyPart) {
        throw new BodyPartNotFoundError(id);
      }

      // Check if body part has photos
      const photoCount = await db.photos.where('bodyPartCategoryId').equals(id).count();
      if (photoCount > 0) {
        throw new BodyPartHasPhotosError(id, photoCount);
      }

      // Get all descendants
      const allBodyParts = await db.bodyPartCategories
        .where('patientId')
        .equals(bodyPart.patientId)
        .toArray();

      const descendants = BodyPartHierarchyUtils.getDescendants(id, allBodyParts);

      // Check if any descendants have photos
      for (const descendant of descendants) {
        const descendantPhotoCount = await db.photos
          .where('bodyPartCategoryId')
          .equals(descendant.id)
          .count();

        if (descendantPhotoCount > 0) {
          throw new BodyPartHasPhotosError(descendant.id, descendantPhotoCount);
        }
      }

      // Delete body part and all descendants
      await db.transaction('rw', db.bodyPartCategories, async () => {
        // Delete descendants first (bottom-up)
        for (const descendant of descendants.reverse()) {
          await db.bodyPartCategories.delete(descendant.id);
        }

        // Delete the main body part
        await db.bodyPartCategories.delete(id);
      });

      console.log(`Body part deleted: ${id} (with ${descendants.length} descendants)`);
      return true;
    } catch (error) {
      if (error instanceof BodyPartNotFoundError || error instanceof BodyPartHasPhotosError) {
        throw error;
      }
      console.error('Failed to delete body part:', error);
      return false;
    }
  }

  /**
   * Reorder body part categories within same level
   */
  async reorderBodyParts(reorderRequests: ReorderRequest[]): Promise<BodyPartCategory[]> {
    // Validate requests
    const validationErrors = BodyPartValidator.validateReorderRequests(reorderRequests);
    if (validationErrors.length > 0) {
      throw new BodyPartValidationError('reorderBodyParts', validationErrors.join(', '));
    }

    try {
      const db = await databaseService.getDatabase();
      const updatedBodyParts: BodyPartCategory[] = [];

      await db.transaction('rw', db.bodyPartCategories, async () => {
        for (const request of reorderRequests) {
          const bodyPart = await db.bodyPartCategories.get(request.id);
          if (!bodyPart) {
            throw new BodyPartNotFoundError(request.id);
          }

          bodyPart.displayOrder = request.newDisplayOrder;
          await db.bodyPartCategories.put(bodyPart);
          updatedBodyParts.push(bodyPart);
        }
      });

      console.log(`Reordered ${updatedBodyParts.length} body parts`);
      return updatedBodyParts;
    } catch (error) {
      if (error instanceof BodyPartNotFoundError || error instanceof BodyPartValidationError) {
        throw error;
      }
      console.error('Failed to reorder body parts:', error);
      throw new BodyPartValidationError('reorderBodyParts', 'Failed to reorder body parts in database');
    }
  }

  /**
   * Move body part to different parent
   */
  async moveBodyPart(id: string, newParentId: string | null): Promise<BodyPartCategory> {
    try {
      const db = await databaseService.getDatabase();

      // Get the body part to move
      const bodyPart = await db.bodyPartCategories.get(id);
      if (!bodyPart) {
        throw new BodyPartNotFoundError(id);
      }

      // Get all body parts for patient to check for circular reference
      const allBodyParts = await db.bodyPartCategories
        .where('patientId')
        .equals(bodyPart.patientId)
        .toArray();

      // Check for circular reference
      if (newParentId && BodyPartHierarchyUtils.wouldCreateCircularReference(id, newParentId, allBodyParts)) {
        throw new CircularReferenceError(id, newParentId);
      }

      await db.transaction('rw', db.bodyPartCategories, async () => {
        // Update the body part's parent
        bodyPart.parentId = newParentId;

        // Update levels for this body part and all its descendants
        const updatedBodyParts = BodyPartHierarchyUtils.updateLevels([
          ...allBodyParts.filter(bp => bp.id !== id),
          bodyPart
        ]);

        // Save all updated body parts
        for (const updatedBodyPart of updatedBodyParts) {
          await db.bodyPartCategories.put(updatedBodyPart);
        }
      });

      // Get the updated body part
      const movedBodyPart = await db.bodyPartCategories.get(id);
      console.log(`Body part moved: ${id} to parent ${newParentId}`);
      return movedBodyPart!;
    } catch (error) {
      if (error instanceof BodyPartNotFoundError || error instanceof CircularReferenceError) {
        throw error;
      }
      console.error('Failed to move body part:', error);
      throw new BodyPartValidationError('moveBodyPart', 'Failed to move body part in database');
    }
  }

  /**
   * Get full path from root to category
   */
  async getBodyPartPath(id: string): Promise<BodyPartCategory[]> {
    try {
      const db = await databaseService.getDatabase();

      // Get the target body part
      const bodyPart = await db.bodyPartCategories.get(id);
      if (!bodyPart) {
        throw new BodyPartNotFoundError(id);
      }

      // Get all body parts for the patient
      const allBodyParts = await db.bodyPartCategories
        .where('patientId')
        .equals(bodyPart.patientId)
        .toArray();

      return BodyPartHierarchyUtils.getPath(id, allBodyParts);
    } catch (error) {
      if (error instanceof BodyPartNotFoundError) {
        throw error;
      }
      console.error('Failed to get body part path:', error);
      return [];
    }
  }

  /**
   * Search body parts by name
   */
  async searchBodyParts(patientId: string, query: string): Promise<BodyPartCategory[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchQuery = query.trim().toLowerCase();

    try {
      const db = await databaseService.getDatabase();

      const bodyParts = await db.bodyPartCategories
        .where('patientId')
        .equals(patientId)
        .filter(bodyPart => bodyPart.name.toLowerCase().includes(searchQuery))
        .sortBy('name');

      return bodyParts;
    } catch (error) {
      console.error('Failed to search body parts:', error);
      return [];
    }
  }

  /**
   * Get body part statistics for a patient
   */
  async getBodyPartStatistics(patientId: string): Promise<BodyPartStatistics> {
    try {
      const db = await databaseService.getDatabase();

      const bodyParts = await db.bodyPartCategories
        .where('patientId')
        .equals(patientId)
        .toArray();

      const totalBodyParts = bodyParts.length;
      const bodyPartsByLevel = bodyParts.reduce((acc, bodyPart) => {
        acc[bodyPart.level] = (acc[bodyPart.level] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      const totalPhotos = bodyParts.reduce((sum, bodyPart) => sum + bodyPart.photoCount, 0);

      return {
        totalBodyParts,
        bodyPartsByLevel,
        totalPhotos,
        averagePhotosPerBodyPart: totalBodyParts > 0 ? Math.round((totalPhotos / totalBodyParts) * 100) / 100 : 0,
      };
    } catch (error) {
      console.error('Failed to get body part statistics:', error);
      return {
        totalBodyParts: 0,
        bodyPartsByLevel: {},
        totalPhotos: 0,
        averagePhotosPerBodyPart: 0,
      };
    }
  }

  /**
   * Get body parts with photos for a patient
   */
  async getBodyPartsWithPhotos(patientId: string): Promise<BodyPartCategory[]> {
    try {
      const db = await databaseService.getDatabase();

      const bodyPartsWithPhotos = await db.bodyPartCategories
        .where('patientId')
        .equals(patientId)
        .filter(bodyPart => bodyPart.photoCount > 0)
        .sortBy('name');

      return bodyPartsWithPhotos;
    } catch (error) {
      console.error('Failed to get body parts with photos:', error);
      return [];
    }
  }

  /**
   * Update photo count for a body part
   */
  async updatePhotoCount(bodyPartId: string, delta: number): Promise<void> {
    try {
      const db = await databaseService.getDatabase();

      await db.bodyPartCategories
        .where('id')
        .equals(bodyPartId)
        .modify(bodyPart => {
          bodyPart.photoCount = Math.max(0, (bodyPart.photoCount || 0) + delta);
        });
    } catch (error) {
      console.error('Failed to update photo count:', error);
    }
  }

  /**
   * Get body part with photo count for display
   */
  async getBodyPartWithPhotoCount(id: string): Promise<BodyPartWithPhotoCount | null> {
    const bodyPart = await this.getBodyPart(id);
    if (!bodyPart) {
      return null;
    }

    try {
      const db = await databaseService.getDatabase();

      // Get actual photo count
      const actualPhotoCount = await db.photos
        .where('bodyPartCategoryId')
        .equals(id)
        .count();

      return {
        ...bodyPart,
        actualPhotoCount,
      };
    } catch (error) {
      console.error('Failed to get body part with photo count:', error);
      return { ...bodyPart, actualPhotoCount: 0 };
    }
  }
}

// Interface for body part statistics
export interface BodyPartStatistics {
  totalBodyParts: number;
  bodyPartsByLevel: Record<number, number>;
  totalPhotos: number;
  averagePhotosPerBodyPart: number;
}

// Interface for body part with actual photo count
export interface BodyPartWithPhotoCount extends BodyPartCategory {
  actualPhotoCount: number;
}

// Export singleton instance
export const bodyPartService = new BodyPartService();