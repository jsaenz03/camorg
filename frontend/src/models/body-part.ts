/**
 * BodyPartCategory model with hierarchy support
 * Represents hierarchical classification of anatomical regions
 */

export interface BodyPartCategory {
  id: string;
  patientId: string;
  name: string;
  parentId: string | null;
  level: number;
  displayOrder: number;
  createdAt: Date;
  photoCount: number;
}

export interface CreateBodyPartRequest {
  patientId: string;
  name: string;
  parentId?: string;
  displayOrder?: number;
}

export interface UpdateBodyPartRequest {
  name?: string;
  parentId?: string;
  displayOrder?: number;
}

export interface ReorderRequest {
  id: string;
  newDisplayOrder: number;
}

export interface BodyPartHierarchy {
  [categoryId: string]: {
    category: BodyPartCategory;
    children: BodyPartHierarchy;
    photoCount: number;
  };
}

/**
 * Validates body part data according to business rules
 */
export class BodyPartValidator {
  static validateCreateRequest(request: CreateBodyPartRequest): string[] {
    const errors: string[] = [];

    // Patient ID validation
    if (!request.patientId || request.patientId.trim().length === 0) {
      errors.push('Patient ID is required');
    }

    // Name validation
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Name is required');
    } else if (request.name.trim().length < 1) {
      errors.push('Name must be at least 1 character long');
    } else if (request.name.trim().length > 50) {
      errors.push('Name must be less than 50 characters');
    }

    // Display order validation
    if (request.displayOrder !== undefined && request.displayOrder < 0) {
      errors.push('Display order must be a positive integer');
    }

    return errors;
  }

  static validateUpdateRequest(request: UpdateBodyPartRequest): string[] {
    const errors: string[] = [];

    // Name validation (if provided)
    if (request.name !== undefined) {
      if (request.name.trim().length === 0) {
        errors.push('Name cannot be empty');
      } else if (request.name.trim().length > 50) {
        errors.push('Name must be less than 50 characters');
      }
    }

    // Display order validation (if provided)
    if (request.displayOrder !== undefined && request.displayOrder < 0) {
      errors.push('Display order must be a positive integer');
    }

    return errors;
  }

  static validateHierarchyLevel(level: number): string[] {
    const errors: string[] = [];
    const MAX_HIERARCHY_LEVELS = 4;

    if (level < 0) {
      errors.push('Hierarchy level cannot be negative');
    } else if (level >= MAX_HIERARCHY_LEVELS) {
      errors.push(`Maximum hierarchy level is ${MAX_HIERARCHY_LEVELS - 1}`);
    }

    return errors;
  }

  static validateReorderRequests(requests: ReorderRequest[]): string[] {
    const errors: string[] = [];

    // Check for duplicate IDs
    const ids = requests.map(r => r.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      errors.push('Cannot reorder: duplicate category IDs in request');
    }

    // Check for invalid display orders
    requests.forEach((request, index) => {
      if (request.newDisplayOrder < 0) {
        errors.push(`Invalid display order at index ${index}: must be positive`);
      }
    });

    return errors;
  }
}

/**
 * Body part factory for creating body part instances
 */
export class BodyPartFactory {
  static create(request: CreateBodyPartRequest, parentLevel = -1): BodyPartCategory {
    const now = new Date();
    const id = crypto.randomUUID();
    const level = parentLevel + 1;

    return {
      id,
      patientId: request.patientId,
      name: request.name.trim(),
      parentId: request.parentId ?? null,
      level,
      displayOrder: request.displayOrder ?? 1,
      createdAt: now,
      photoCount: 0,
    };
  }

  static update(existing: BodyPartCategory, request: UpdateBodyPartRequest): BodyPartCategory {
    return {
      ...existing,
      name: request.name?.trim() ?? existing.name,
      parentId: request.parentId !== undefined ? request.parentId : existing.parentId,
      displayOrder: request.displayOrder ?? existing.displayOrder,
    };
  }
}

/**
 * Hierarchy utilities for working with body part trees
 */
export class BodyPartHierarchyUtils {
  /**
   * Build hierarchy tree from flat array of body parts
   */
  static buildHierarchy(bodyParts: BodyPartCategory[]): BodyPartHierarchy {
    const categoryMap = new Map<string, BodyPartCategory>();

    // Create lookup map
    bodyParts.forEach(part => {
      categoryMap.set(part.id, part);
    });

    // Helper function to build tree recursively
    const buildTree = (parentId: string | null, level: number): BodyPartHierarchy => {
      const tree: BodyPartHierarchy = {};

      bodyParts
        .filter(part => part.parentId === parentId && part.level === level)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .forEach(part => {
          tree[part.id] = {
            category: part,
            children: buildTree(part.id, level + 1),
            photoCount: part.photoCount,
          };
        });

      return tree;
    };

    return buildTree(null, 0);
  }

  /**
   * Get path from root to specific category
   */
  static getPath(categoryId: string, bodyParts: BodyPartCategory[]): BodyPartCategory[] {
    const categoryMap = new Map<string, BodyPartCategory>();
    bodyParts.forEach(part => categoryMap.set(part.id, part));

    const path: BodyPartCategory[] = [];
    let currentId: string | null = categoryId;

    while (currentId) {
      const category = categoryMap.get(currentId);
      if (!category) break;

      path.unshift(category);
      currentId = category.parentId;
    }

    return path;
  }

  /**
   * Check if moving a category would create a circular reference
   */
  static wouldCreateCircularReference(
    categoryId: string,
    newParentId: string,
    bodyParts: BodyPartCategory[]
  ): boolean {
    if (categoryId === newParentId) return true;

    const path = this.getPath(newParentId, bodyParts);
    return path.some(category => category.id === categoryId);
  }

  /**
   * Get all descendant categories
   */
  static getDescendants(categoryId: string, bodyParts: BodyPartCategory[]): BodyPartCategory[] {
    const descendants: BodyPartCategory[] = [];

    const findChildren = (parentId: string): void => {
      const children = bodyParts.filter(part => part.parentId === parentId);
      children.forEach(child => {
        descendants.push(child);
        findChildren(child.id);
      });
    };

    findChildren(categoryId);
    return descendants;
  }

  /**
   * Update levels after hierarchy change
   */
  static updateLevels(bodyParts: BodyPartCategory[]): BodyPartCategory[] {
    const categoryMap = new Map<string, BodyPartCategory>();
    bodyParts.forEach(part => categoryMap.set(part.id, { ...part }));

    // Update levels starting from root
    const updateLevel = (categoryId: string, level: number): void => {
      const category = categoryMap.get(categoryId);
      if (!category) return;

      category.level = level;

      // Update children
      bodyParts
        .filter(part => part.parentId === categoryId)
        .forEach(child => updateLevel(child.id, level + 1));
    };

    // Update all root categories (parentId = null)
    bodyParts
      .filter(part => part.parentId === null)
      .forEach(root => updateLevel(root.id, 0));

    return Array.from(categoryMap.values());
  }
}

// Error classes
export class BodyPartNotFoundError extends Error {
  constructor(id: string) {
    super(`Body part category with ID ${id} not found`);
    this.name = 'BodyPartNotFoundError';
  }
}

export class BodyPartValidationError extends Error {
  constructor(field: string, message: string) {
    super(`Validation error for ${field}: ${message}`);
    this.name = 'BodyPartValidationError';
  }
}

export class BodyPartHasPhotosError extends Error {
  constructor(id: string, photoCount: number) {
    super(`Cannot delete body part ${id}: contains ${photoCount} photos`);
    this.name = 'BodyPartHasPhotosError';
  }
}

export class CircularReferenceError extends Error {
  constructor(childId: string, parentId: string) {
    super(`Moving category ${childId} to parent ${parentId} would create circular reference`);
    this.name = 'CircularReferenceError';
  }
}