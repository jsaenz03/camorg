import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Body Part Organization Integration Tests', () => {
  let testPatient: any;

  beforeEach(async () => {
    // Setup test patient
    testPatient = await window.patientService.createPatient({
      name: 'Body Part Test Patient',
      dateOfBirth: new Date('1975-05-10'),
      assignedDoctor: 'Dr. Anatomy'
    });
  });

  afterEach(async () => {
    // Clean up test data
    if (testPatient) {
      await window.patientService.deletePatient(testPatient.id);
    }
  });

  it('should create and manage hierarchical body part structure', async () => {
    // Step 1: Create root level body part
    const leftArm = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Left Arm',
      parentId: null,
      displayOrder: 1
    });

    expect(leftArm.level).toBe(0);
    expect(leftArm.parentId).toBeNull();

    // Step 2: Create second level (sub-part)
    const forearm = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Forearm',
      parentId: leftArm.id,
      displayOrder: 1
    });

    expect(forearm.level).toBe(1);
    expect(forearm.parentId).toBe(leftArm.id);

    // Step 3: Create third level (nested sub-part)
    const wristArea = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Wrist Area',
      parentId: forearm.id,
      displayOrder: 1
    });

    expect(wristArea.level).toBe(2);
    expect(wristArea.parentId).toBe(forearm.id);

    // Step 4: Verify hierarchical structure
    const hierarchy = await window.bodyPartService.getBodyPartsForPatient(testPatient.id);
    expect(hierarchy[leftArm.id]).toBeDefined();
    expect(hierarchy[leftArm.id].children[forearm.id]).toBeDefined();
    expect(hierarchy[leftArm.id].children[forearm.id].children[wristArea.id]).toBeDefined();

    // Step 5: Test path traversal
    const path = await window.bodyPartService.getBodyPartPath(wristArea.id);
    expect(path).toHaveLength(3);
    expect(path[0].id).toBe(leftArm.id);
    expect(path[1].id).toBe(forearm.id);
    expect(path[2].id).toBe(wristArea.id);

    // Step 6: Test moving body parts
    const rightArm = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Right Arm',
      parentId: null,
      displayOrder: 2
    });

    // Move forearm from left arm to right arm
    const movedForearm = await window.bodyPartService.moveBodyPart(forearm.id, rightArm.id);
    expect(movedForearm.parentId).toBe(rightArm.id);

    // Step 7: Test reordering
    const reorderRequests = [
      { id: rightArm.id, newDisplayOrder: 1 },
      { id: leftArm.id, newDisplayOrder: 2 }
    ];

    const reorderedParts = await window.bodyPartService.reorderBodyParts(reorderRequests);
    expect(reorderedParts.find(p => p.id === rightArm.id)?.displayOrder).toBe(1);
    expect(reorderedParts.find(p => p.id === leftArm.id)?.displayOrder).toBe(2);
  });

  it('should handle body part search and filtering', async () => {
    // Create multiple body parts
    const bodyParts = [
      { name: 'Left Arm', parentId: null },
      { name: 'Right Arm', parentId: null },
      { name: 'Torso', parentId: null },
      { name: 'Left Leg', parentId: null }
    ];

    const createdParts = await Promise.all(
      bodyParts.map((part, index) =>
        window.bodyPartService.createBodyPart({
          patientId: testPatient.id,
          name: part.name,
          parentId: part.parentId,
          displayOrder: index + 1
        })
      )
    );

    // Search for 'arm' parts
    const armParts = await window.bodyPartService.searchBodyParts(testPatient.id, 'arm');
    expect(armParts).toHaveLength(2);
    expect(armParts.every(p => p.name.toLowerCase().includes('arm'))).toBe(true);

    // Search for 'left' parts
    const leftParts = await window.bodyPartService.searchBodyParts(testPatient.id, 'left');
    expect(leftParts).toHaveLength(2);
    expect(leftParts.every(p => p.name.toLowerCase().includes('left'))).toBe(true);

    // Get root body parts
    const rootParts = await window.bodyPartService.getRootBodyParts(testPatient.id);
    expect(rootParts).toHaveLength(4);
    expect(rootParts.every(p => p.level === 0)).toBe(true);
  });

  it('should maintain photo count for body parts', async () => {
    // Create body part
    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Test Area',
      parentId: null
    });

    expect(bodyPart.photoCount).toBe(0);

    // Add photos to the body part
    const photo1 = await window.photoService.capturePhoto({
      patientId: testPatient.id,
      bodyPartCategoryId: bodyPart.id,
      description: 'First photo'
    });

    const photo2 = await window.photoService.capturePhoto({
      patientId: testPatient.id,
      bodyPartCategoryId: bodyPart.id,
      description: 'Second photo'
    });

    // Verify photo count is updated
    const updatedBodyPart = await window.bodyPartService.getBodyPart(bodyPart.id);
    expect(updatedBodyPart?.photoCount).toBe(2);

    // Delete one photo and verify count
    await window.photoService.deletePhoto(photo1.id);
    const bodyPartAfterDelete = await window.bodyPartService.getBodyPart(bodyPart.id);
    expect(bodyPartAfterDelete?.photoCount).toBe(1);

    // Clean up
    await window.photoService.deletePhoto(photo2.id);
  });

  it('should prevent circular references in hierarchy', async () => {
    // Create parent-child relationship
    const parent = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Parent',
      parentId: null
    });

    const child = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Child',
      parentId: parent.id
    });

    // Attempt to create circular reference (move parent to be child of child)
    await expect(
      window.bodyPartService.moveBodyPart(parent.id, child.id)
    ).rejects.toThrow('CircularReferenceError');
  });

  it('should prevent deletion of body parts with photos', async () => {
    // Create body part
    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Protected Area',
      parentId: null
    });

    // Add photo to body part
    const photo = await window.photoService.capturePhoto({
      patientId: testPatient.id,
      bodyPartCategoryId: bodyPart.id,
      description: 'Protection test photo'
    });

    // Attempt to delete body part with photos
    await expect(
      window.bodyPartService.deleteBodyPart(bodyPart.id)
    ).rejects.toThrow('BodyPartHasPhotosError');

    // Delete photo first, then body part should be deletable
    await window.photoService.deletePhoto(photo.id);
    const deleteResult = await window.bodyPartService.deleteBodyPart(bodyPart.id);
    expect(deleteResult).toBe(true);
  });

  it('should validate body part constraints', async () => {
    // Test empty name validation
    await expect(window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: '', // Invalid: empty name
      parentId: null
    })).rejects.toThrow('BodyPartValidationError');

    // Test invalid display order
    await expect(window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Valid Name',
      parentId: null,
      displayOrder: -1 // Invalid: negative order
    })).rejects.toThrow('BodyPartValidationError');

    // Test non-existent parent ID
    await expect(window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Valid Name',
      parentId: 'non-existent-id' // Invalid: non-existent parent
    })).rejects.toThrow('BodyPartValidationError');
  });
});