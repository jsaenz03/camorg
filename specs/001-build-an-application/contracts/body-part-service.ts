/**
 * Body Part Service Contract
 * Defines the interface for body part category management
 */

import { BodyPartCategory, CreateBodyPartRequest, UpdateBodyPartRequest } from '../models/body-part';

export interface BodyPartService {
  /**
   * Create a new body part category
   * @param request Body part creation data
   * @returns Promise resolving to created category with generated ID
   * @throws BodyPartValidationError if data is invalid
   */
  createBodyPart(request: CreateBodyPartRequest): Promise<BodyPartCategory>;

  /**
   * Update existing body part category
   * @param id Category ID
   * @param request Updated category data
   * @returns Promise resolving to updated category
   * @throws BodyPartNotFoundError if category doesn't exist
   * @throws BodyPartValidationError if data is invalid
   */
  updateBodyPart(id: string, request: UpdateBodyPartRequest): Promise<BodyPartCategory>;

  /**
   * Get body part category by ID
   * @param id Category ID
   * @returns Promise resolving to category or null if not found
   */
  getBodyPart(id: string): Promise<BodyPartCategory | null>;

  /**
   * Get all body part categories for a patient
   * @param patientId Patient ID
   * @returns Promise resolving to hierarchical tree structure
   */
  getBodyPartsForPatient(patientId: string): Promise<BodyPartHierarchy>;

  /**
   * Get top-level body part categories for a patient
   * @param patientId Patient ID
   * @returns Promise resolving to root categories
   */
  getRootBodyParts(patientId: string): Promise<BodyPartCategory[]>;

  /**
   * Get child categories of a specific body part
   * @param parentId Parent category ID
   * @returns Promise resolving to child categories
   */
  getChildBodyParts(parentId: string): Promise<BodyPartCategory[]>;

  /**
   * Delete body part category and all children
   * @param id Category ID
   * @returns Promise resolving to boolean indicating success
   * @throws BodyPartNotFoundError if category doesn't exist
   * @throws BodyPartHasPhotosError if category contains photos
   */
  deleteBodyPart(id: string): Promise<boolean>;

  /**
   * Reorder body part categories within same level
   * @param reorderRequests Array of ID and new display order
   * @returns Promise resolving to updated categories
   */
  reorderBodyParts(reorderRequests: ReorderRequest[]): Promise<BodyPartCategory[]>;

  /**
   * Move body part to different parent
   * @param id Category ID to move
   * @param newParentId New parent ID (null for root level)
   * @returns Promise resolving to updated category
   * @throws BodyPartNotFoundError if category doesn't exist
   * @throws CircularReferenceError if move would create circular reference
   */
  moveBodyPart(id: string, newParentId: string | null): Promise<BodyPartCategory>;

  /**
   * Get full path from root to category
   * @param id Category ID
   * @returns Promise resolving to array of categories from root to target
   */
  getBodyPartPath(id: string): Promise<BodyPartCategory[]>;

  /**
   * Search body parts by name
   * @param patientId Patient ID
   * @param query Search query
   * @returns Promise resolving to matching categories
   */
  searchBodyParts(patientId: string, query: string): Promise<BodyPartCategory[]>;
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

// Error types
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