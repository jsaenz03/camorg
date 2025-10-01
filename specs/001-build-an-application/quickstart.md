# Quickstart Guide: Dermatology Photo Organization System

## Overview
This guide provides step-by-step instructions to validate the core functionality of the dermatology photo organization system through manual testing of key user workflows.

## Prerequisites
- Modern web browser with camera support (Chrome 90+, Firefox 88+, Safari 14+)
- Camera device (webcam or mobile device camera)
- File system write permissions
- Local development server running

## Test Scenarios

### Scenario 1: Patient Management
**Objective**: Verify basic patient CRUD operations

**Steps**:
1. **Navigate to application** at `http://localhost:5173`
2. **Create new patient**:
   - Click "Add New Patient" button
   - Fill form:
     - Name: "John Doe"
     - Date of Birth: "1985-06-15"
     - Assigned Doctor: "Dr. Smith"
   - Click "Save Patient"
3. **Verify patient created**:
   - Patient appears in patient list
   - Patient details are displayed correctly
   - Patient ID is generated automatically
4. **Edit patient**:
   - Click "Edit" button for John Doe
   - Change assigned doctor to "Dr. Johnson"
   - Add note: "Initial consultation scheduled"
   - Click "Update Patient"
5. **Search patient**:
   - Use search box to find "John"
   - Verify John Doe appears in results
6. **Mark patient urgent**:
   - Click "Mark Urgent" toggle
   - Verify urgent indicator appears

**Expected Results**:
- ✅ Patient successfully created with auto-generated ID
- ✅ Patient information displays correctly
- ✅ Patient details can be edited and saved
- ✅ Search functionality returns correct results
- ✅ Urgent flag toggles correctly

### Scenario 2: Body Part Organization
**Objective**: Verify hierarchical body part categorization

**Steps**:
1. **Select John Doe patient** from previous scenario
2. **Create root body part**:
   - Click "Add Body Part" button
   - Enter name: "Left Arm"
   - Select level: "Primary"
   - Click "Save"
3. **Create sub-category**:
   - Select "Left Arm" category
   - Click "Add Sub-Part"
   - Enter name: "Forearm"
   - Click "Save"
4. **Create nested sub-category**:
   - Select "Forearm" category
   - Click "Add Sub-Part"
   - Enter name: "Wrist Area"
   - Click "Save"
5. **Verify hierarchy**:
   - Navigate through: Left Arm → Forearm → Wrist Area
   - Verify breadcrumb navigation works
   - Verify parent-child relationships display correctly

**Expected Results**:
- ✅ Root category "Left Arm" created successfully
- ✅ Sub-category "Forearm" nested under "Left Arm"
- ✅ Sub-sub-category "Wrist Area" nested under "Forearm"
- ✅ Hierarchical navigation works correctly
- ✅ Breadcrumb navigation shows full path

### Scenario 3: Photo Capture and Management
**Objective**: Verify camera integration and photo organization

**Steps**:
1. **Navigate to "Wrist Area"** body part from previous scenario
2. **Capture photo**:
   - Click "Take Photo" button
   - Allow camera permissions when prompted
   - Position camera to capture test image
   - Click capture button
   - Add description: "Initial lesion documentation"
   - Click "Save Photo"
3. **Verify photo saved**:
   - Photo appears in grid view
   - Thumbnail is generated automatically
   - Photo metadata is displayed (date, size, etc.)
4. **Import existing photo**:
   - Click "Import Photo" button
   - Select image file from computer
   - Add description: "Previous documentation"
   - Set capture date to one week ago
   - Click "Import"
5. **View progress comparison**:
   - Click "Progress View" button
   - Verify both photos display in chronological order
   - Verify date stamps are correct

**Expected Results**:
- ✅ Camera access works without errors
- ✅ Photo captures and saves successfully
- ✅ Thumbnail generates automatically
- ✅ Photo metadata displays correctly
- ✅ File import functionality works
- ✅ Progress view shows chronological comparison

### Scenario 4: Photo Organization and Search
**Objective**: Verify photo filtering and search capabilities

**Steps**:
1. **Create additional body parts** for testing:
   - Add "Right Arm" with "Shoulder" subcategory
   - Add photos to different body parts
2. **Test filtering**:
   - Filter photos by date range (last 7 days)
   - Filter photos by body part ("Left Arm")
   - Filter photos by urgent flag
3. **Test search**:
   - Search for photos by description keywords
   - Search for photos by body part name
4. **Test sorting**:
   - Sort by date (newest first)
   - Sort by body part alphabetically
   - Sort by file size

**Expected Results**:
- ✅ Date range filtering works correctly
- ✅ Body part filtering shows relevant photos only
- ✅ Urgent flag filtering works
- ✅ Search returns relevant results
- ✅ All sorting options function correctly

### Scenario 5: Progress Tracking
**Objective**: Verify timeline and progress comparison features

**Steps**:
1. **Add multiple photos** to same body part over time:
   - Capture/import 3 photos for "Wrist Area"
   - Set different capture dates (1 week apart)
   - Add descriptive notes for each
2. **View progress timeline**:
   - Navigate to "Wrist Area"
   - Click "Timeline View"
   - Verify photos display chronologically
3. **Compare photos**:
   - Select 2 photos for comparison
   - Click "Compare" button
   - Verify side-by-side view works
4. **Add progress notes**:
   - Click on latest photo
   - Add medical notes about changes
   - Save notes

**Expected Results**:
- ✅ Timeline view displays photos chronologically
- ✅ Photo comparison view works correctly
- ✅ Progress notes can be added and saved
- ✅ Visual progression is clear in timeline

### Scenario 6: PDF Export
**Objective**: Verify report generation and export functionality

**Steps**:
1. **Generate patient summary report**:
   - Go to John Doe's patient profile
   - Click "Generate Report"
   - Select "Progress Summary" template
   - Set date range to include all photos
   - Include progress comparison
   - Click "Generate PDF"
2. **Verify report content**:
   - PDF opens in new tab/window
   - Patient information is included
   - All relevant photos are included
   - Photos are properly formatted and sized
   - Date stamps are correct
3. **Download report**:
   - Click "Download" button
   - Verify file saves to local system
   - Open downloaded PDF to verify content

**Expected Results**:
- ✅ PDF generates without errors
- ✅ All patient information included correctly
- ✅ Photos display properly in PDF
- ✅ Report formatting is professional
- ✅ File downloads successfully

### Scenario 7: Offline Functionality
**Objective**: Verify application works without internet connection

**Steps**:
1. **Disconnect from internet** (disable WiFi/ethernet)
2. **Verify existing functionality**:
   - Navigate between patients
   - View photos and progress timelines
   - Access all previously created data
3. **Test offline photo capture**:
   - Capture new photo while offline
   - Verify photo saves locally
   - Add metadata and descriptions
4. **Reconnect to internet**:
   - Re-enable network connection
   - Verify all offline changes are preserved
   - Verify no data loss occurred

**Expected Results**:
- ✅ Application functions fully while offline
- ✅ All data remains accessible offline
- ✅ Photo capture works without internet
- ✅ Data persists when coming back online
- ✅ No data loss or corruption

## Data Validation Tests

### Database Integrity
1. **Check IndexedDB structure**:
   - Open browser DevTools → Application → IndexedDB
   - Verify all tables exist: patients, photos, bodyParts, exportReports
   - Verify sample data is properly structured
2. **Verify relationships**:
   - Patient records link correctly to photos
   - Body part hierarchy maintains parent-child relationships
   - Photo metadata includes all required fields

### File System Organization
1. **Check photo storage**:
   - Verify photos are saved to user-selected directory
   - Check folder structure matches patient/body-part hierarchy
   - Verify thumbnails are generated in correct locations
2. **Verify file naming**:
   - Photo files use consistent naming convention
   - No special characters that could cause issues
   - File extensions match actual file types

## Performance Validation

### Loading Times
- **Initial app load**: < 2 seconds
- **Patient list with 10 patients**: < 1 second
- **Photo grid with 20 photos**: < 3 seconds
- **PDF generation with 10 photos**: < 5 seconds

### Memory Usage
- **Baseline application**: < 50MB
- **With 100 photos loaded**: < 200MB
- **During PDF generation**: < 300MB

### Camera Performance
- **Camera access time**: < 2 seconds
- **Photo capture response**: < 1 second
- **Thumbnail generation**: < 2 seconds per photo

## Troubleshooting Common Issues

### Camera Access Denied
- **Symptoms**: Camera permission dialog doesn't appear or access fails
- **Solution**: Check browser permissions, ensure HTTPS or localhost
- **Verification**: Try accessing camera in browser settings

### File Save Errors
- **Symptoms**: Photos fail to save to file system
- **Solution**: Check File System Access API support, try different directory
- **Verification**: Manually verify files are created in selected folder

### Performance Issues
- **Symptoms**: Slow loading or laggy interactions
- **Solution**: Clear browser cache, reduce number of photos in view
- **Verification**: Monitor DevTools Performance tab

### Data Not Persisting
- **Symptoms**: Patient or photo data disappears on refresh
- **Solution**: Check IndexedDB permissions, clear corrupted storage
- **Verification**: Inspect IndexedDB in DevTools

## Success Criteria
All scenarios must pass with expected results. Any failures should be documented with:
- Exact steps to reproduce
- Browser and OS version
- Error messages or unexpected behavior
- Screenshots of issues

This quickstart validation ensures the core dermatology photo organization workflows function correctly before proceeding to full implementation.