# Body Parts Reference

## Overview

The dermatology photo organization app includes a comprehensive, hierarchical body parts structure that is automatically initialized for each new patient. This allows for precise organization of dermatological photos by anatomical location.

## Automatic Initialization

When a new patient is created, the system automatically initializes **all default body parts** for that patient. This happens seamlessly in the background during patient creation.

## Body Parts Structure

The body parts are organized in a hierarchical tree structure with up to 4 levels:

### Level 0: Major Body Regions (6 categories)

1. **Head & Neck**
2. **Torso**
3. **Upper Extremities**
4. **Lower Extremities**
5. **Groin & Buttocks**
6. **Other**

---

## Complete Body Parts List

### 1. Head & Neck (18 sub-parts)
- Scalp
- Forehead
- Left Temple / Right Temple
- Left Eye Area / Right Eye Area
- Nose
- Left Cheek / Right Cheek
- Left Ear / Right Ear
- Lips
- Chin
- Jaw
- Neck - Front
- Neck - Back
- Neck - Left Side / Neck - Right Side

### 2. Torso (8 sub-parts)
- Chest
- Abdomen
- Upper Back
- Lower Back
- Left Shoulder / Right Shoulder
- Left Side / Right Side

### 3. Upper Extremities (4 major sections, 26 total parts)

#### Left Arm (6 parts)
- Left Upper Arm - Front
- Left Upper Arm - Back
- Left Elbow
- Left Forearm - Front
- Left Forearm - Back
- Left Wrist

#### Right Arm (6 parts)
- Right Upper Arm - Front
- Right Upper Arm - Back
- Right Elbow
- Right Forearm - Front
- Right Forearm - Back
- Right Wrist

#### Left Hand (7 parts)
- Left Palm
- Left Back of Hand
- Left Thumb
- Left Index Finger
- Left Middle Finger
- Left Ring Finger
- Left Pinky Finger

#### Right Hand (7 parts)
- Right Palm
- Right Back of Hand
- Right Thumb
- Right Index Finger
- Right Middle Finger
- Right Ring Finger
- Right Pinky Finger

### 4. Lower Extremities (4 major sections, 28 total parts)

#### Left Leg (7 parts)
- Left Hip
- Left Thigh - Front
- Left Thigh - Back
- Left Knee
- Left Lower Leg - Front
- Left Lower Leg - Back
- Left Ankle

#### Right Leg (7 parts)
- Right Hip
- Right Thigh - Front
- Right Thigh - Back
- Right Knee
- Right Lower Leg - Front
- Right Lower Leg - Back
- Right Ankle

#### Left Foot (5 parts)
- Left Foot - Top
- Left Foot - Bottom
- Left Heel
- Left Big Toe
- Left Toes

#### Right Foot (5 parts)
- Right Foot - Top
- Right Foot - Bottom
- Right Heel
- Right Big Toe
- Right Toes

### 5. Groin & Buttocks (5 sub-parts)
- Groin - Left
- Groin - Right
- Buttocks - Left
- Buttocks - Right
- Gluteal Fold

### 6. Other (2 sub-parts)
- General/Full Body
- Unspecified Location

---

## Statistics

- **Total Body Parts**: 93 anatomical locations
- **Major Regions**: 6 top-level categories
- **Maximum Hierarchy Depth**: 3 levels
- **Left/Right Distinctions**: Included for all paired anatomical structures

## Features

### Hierarchical Organization
Body parts are organized in a tree structure, allowing for flexible drill-down navigation:
- Level 0: Major regions (Head & Neck, Torso, etc.)
- Level 1: Body sections (Left Arm, Right Leg, etc.)
- Level 2: Specific locations (Left Elbow, Right Knee, etc.)

### Automatic Photo Organization
When photos are captured or imported, they can be assigned to specific body parts, making it easy to:
- View all photos for a specific anatomical location
- Track changes over time for particular areas
- Generate reports organized by body region

### Extensibility
While the default body parts cover comprehensive dermatological needs, users can:
- Add custom body parts for specific use cases
- Create nested subcategories up to 4 levels deep
- Organize photos in whatever structure makes sense for their workflow

## Technical Details

### Data Files
- **Template**: `/frontend/src/data/default-body-parts.ts` - Contains the default body parts structure
- **Initializer**: `/frontend/src/services/body-part-initializer.ts` - Handles automatic initialization
- **Service**: `/frontend/src/services/body-part-service.ts` - CRUD operations for body parts

### Initialization Process
1. New patient is created via `PatientService.createPatient()`
2. System automatically calls `bodyPartInitializer.initializeBodyPartsForPatient()`
3. All 93 body parts are created in the database with proper hierarchy
4. Each body part is linked to the patient's ID
5. Display order is preserved for consistent UI presentation

### Database Schema
Body parts are stored with the following fields:
- `id`: Unique identifier
- `patientId`: Links to patient record
- `name`: Anatomical location name
- `parentId`: Parent category (null for root level)
- `level`: Hierarchy depth (0-3)
- `displayOrder`: Sort order within level
- `photoCount`: Number of photos assigned
- `createdAt`: Creation timestamp

## Usage in Application

### When Creating a Patient
Body parts are automatically initialized - no action needed.

### When Capturing Photos
1. Select the patient
2. Choose the body part from the hierarchical tree
3. Capture or import photo
4. Photo is automatically linked to that body part

### When Viewing Photos
- Filter photos by body part
- Navigate the hierarchical structure
- See photo counts for each anatomical location
- View progression over time for specific areas

## Customization

If you need to modify the default body parts:

1. Edit `/frontend/src/data/default-body-parts.ts`
2. Modify the `DEFAULT_BODY_PARTS` array
3. Rebuild the application
4. New patients will receive the updated structure
5. Existing patients retain their current body parts

**Note**: Changing the default structure does not affect existing patients. To update existing patients, you would need to implement a migration script.

## Best Practices

1. **Consistent Naming**: Use clear, anatomically correct terminology
2. **Left/Right Distinction**: Always specify left vs right for paired structures
3. **Granularity**: Balance between too many categories and too few
4. **Photo Assignment**: Assign photos to the most specific body part available
5. **Custom Categories**: Add custom categories only when necessary to avoid clutter
