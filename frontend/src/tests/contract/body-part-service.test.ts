import { describe, it, expect, beforeEach } from 'vitest';
import { BodyPartService } from '../../services/body-part-service';
import type { CreateBodyPartRequest, UpdateBodyPartRequest } from '../../models/body-part';

describe('BodyPartService Contract Tests', () => {
  let bodyPartService: BodyPartService;

  beforeEach(() => {
    bodyPartService = new BodyPartService();
  });

  describe('createBodyPart', () => {
    it('should create a new body part category with generated ID', async () => {
      const request: CreateBodyPartRequest = {
        patientId: 'patient-123',
        name: 'Left Arm',
        parentId: null, // Root level
        displayOrder: 1
      };

      const bodyPart = await bodyPartService.createBodyPart(request);

      expect(bodyPart).toBeDefined();
      expect(bodyPart.id).toBeTruthy();
      expect(bodyPart.patientId).toBe(request.patientId);
      expect(bodyPart.name).toBe(request.name);
      expect(bodyPart.parentId).toBeNull();
      expect(bodyPart.level).toBe(0); // Root level
      expect(bodyPart.displayOrder).toBe(request.displayOrder);
      expect(bodyPart.photoCount).toBe(0);
      expect(bodyPart.createdAt).toBeInstanceOf(Date);
    });

    it('should create nested body part with correct level', async () => {
      const request: CreateBodyPartRequest = {
        patientId: 'patient-123',
        name: 'Forearm',
        parentId: 'parent-body-part-id',
        displayOrder: 1
      };

      const bodyPart = await bodyPartService.createBodyPart(request);

      expect(bodyPart.parentId).toBe(request.parentId);
      expect(bodyPart.level).toBeGreaterThan(0);
    });

    it('should throw BodyPartValidationError for invalid data', async () => {
      const invalidRequest: CreateBodyPartRequest = {
        patientId: '',
        name: '', // Invalid: empty name
        displayOrder: -1 // Invalid: negative order
      };

      await expect(bodyPartService.createBodyPart(invalidRequest))
        .rejects.toThrow('BodyPartValidationError');
    });
  });

  describe('getBodyPartsForPatient', () => {
    it('should return hierarchical tree structure', async () => {
      const patientId = 'patient-123';

      const hierarchy = await bodyPartService.getBodyPartsForPatient(patientId);

      expect(typeof hierarchy).toBe('object');

      // Check structure of hierarchy object
      Object.values(hierarchy).forEach(item => {
        expect(item).toHaveProperty('category');
        expect(item).toHaveProperty('children');
        expect(item).toHaveProperty('photoCount');
        expect(item.category.patientId).toBe(patientId);
      });
    });
  });

  describe('getChildBodyParts', () => {
    it('should return child categories of parent', async () => {
      const parentId = 'parent-body-part-id';

      const children = await bodyPartService.getChildBodyParts(parentId);

      expect(Array.isArray(children)).toBe(true);
      children.forEach(child => {
        expect(child.parentId).toBe(parentId);
      });
    });
  });

  describe('moveBodyPart', () => {
    it('should move body part to new parent', async () => {
      const categoryId = 'body-part-123';
      const newParentId = 'new-parent-456';

      const updatedCategory = await bodyPartService.moveBodyPart(categoryId, newParentId);

      expect(updatedCategory.id).toBe(categoryId);
      expect(updatedCategory.parentId).toBe(newParentId);
    });

    it('should throw CircularReferenceError for invalid move', async () => {
      const parentId = 'parent-123';
      const childId = 'child-456';

      // Trying to move parent to be child of its own child
      await expect(bodyPartService.moveBodyPart(parentId, childId))
        .rejects.toThrow('CircularReferenceError');
    });
  });

  describe('getBodyPartPath', () => {
    it('should return path from root to category', async () => {
      const categoryId = 'nested-category-123';

      const path = await bodyPartService.getBodyPartPath(categoryId);

      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThan(0);

      // Last item should be the target category
      expect(path[path.length - 1].id).toBe(categoryId);

      // Path should be ordered from root to target
      for (let i = 1; i < path.length; i++) {
        expect(path[i].parentId).toBe(path[i - 1].id);
      }
    });
  });
});