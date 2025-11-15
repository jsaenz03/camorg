import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PatientService } from '@/services/patient-service';
import { BodyPartService } from '@/services/body-part-service';
import { PhotoService } from '@/services/photo-service';
import { PhotoCaptureDialog } from '@/components/photo/PhotoCaptureDialog';
import { PhotoThumbnail } from '@/components/photo/PhotoThumbnail';
import { PhotoDetailDialog } from '@/components/photo/PhotoDetailDialog';
import { PatientEditDialog } from '@/components/patient/PatientEditDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { Patient } from '@/models/patient';
import type { BodyPartCategory } from '@/models/body-part';
import type { Photo } from '@/models/photo';
import { ArrowLeft, Camera, Calendar, User, FolderTree, Image as ImageIcon, Trash2, Edit } from 'lucide-react';

interface PatientDetailPageProps {
  patientId: string;
  onBack: () => void;
}

export function PatientDetailPage({ patientId, onBack }: PatientDetailPageProps) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [bodyParts, setBodyParts] = useState<BodyPartCategory[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [photoToDelete, setPhotoToDelete] = useState<Photo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingPatient, setIsDeletingPatient] = useState(false);

  const patientService = new PatientService();
  const bodyPartService = new BodyPartService();
  const photoService = new PhotoService();

  useEffect(() => {
    loadPatientData();
  }, [patientId]);

  const loadPatientData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load patient details
      const patientData = await patientService.getPatient(patientId);
      if (!patientData) {
        setError('Patient not found');
        return;
      }
      setPatient(patientData);

      // Load body parts hierarchy and flatten to get all levels
      const bodyPartHierarchy = await bodyPartService.getBodyPartsForPatient(patientId);

      // Flatten the hierarchy to get all body parts at all levels
      const flattenHierarchy = (hierarchy: typeof bodyPartHierarchy): BodyPartCategory[] => {
        const result: BodyPartCategory[] = [];

        const traverse = (node: typeof bodyPartHierarchy) => {
          Object.values(node).forEach(item => {
            result.push(item.category);
            if (item.children && Object.keys(item.children).length > 0) {
              traverse(item.children);
            }
          });
        };

        traverse(hierarchy);
        return result;
      };

      const bodyPartsList = flattenHierarchy(bodyPartHierarchy);
      setBodyParts(bodyPartsList);

      // Load all photos for patient
      const allPhotos = await photoService.getPhotosForPatient(patientId);
      setPhotos(allPhotos);

    } catch (err) {
      setError('Failed to load patient data');
      console.error('Error loading patient data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  const filteredPhotos = selectedBodyPart
    ? photos.filter(p => p.bodyPartCategoryId === selectedBodyPart)
    : photos;

  const getPhotoCountForBodyPart = (bodyPartId: string) => {
    return photos.filter(p => p.bodyPartCategoryId === bodyPartId).length;
  };

  const handlePhotoSaved = (savedPhoto: Photo) => {
    // Add the new photo to the existing photos
    setPhotos(prevPhotos => [savedPhoto, ...prevPhotos]);

    // If we have a body part selected and it matches the photo's body part,
    // the photo will automatically appear in the filtered view
    toast({
      title: "Photo captured successfully",
      description: "The photo has been saved and added to the patient's record.",
      variant: "success",
    });
  };

  const handlePhotoClick = (photo: Photo) => {
    setSelectedPhoto(photo);
    setShowDetailDialog(true);
  };

  const handlePhotoDelete = (photo: Photo) => {
    setPhotoToDelete(photo);
    setDeleteConfirmOpen(true);
  };

  const confirmDeletePhoto = async () => {
    if (!photoToDelete) return;

    try {
      setIsDeleting(true);
      await photoService.deletePhoto(photoToDelete.id);

      // Remove photo from the state
      setPhotos(prevPhotos => prevPhotos.filter(p => p.id !== photoToDelete!.id));

      toast({
        title: "Photo deleted successfully",
        description: "The photo has been removed from the patient's record.",
        variant: "success",
      });
      setDeleteConfirmOpen(false);
      setPhotoToDelete(null);
    } catch (error) {
      console.error('Failed to delete photo:', error);
      toast({
        title: "Failed to delete photo",
        description: "There was an error deleting the photo. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePatientUpdated = (updatedPatient: Patient) => {
    setPatient(updatedPatient);
    toast({
      title: "Patient information updated",
      description: "The patient's information has been successfully updated.",
      variant: "success",
    });
  };

  const handleDeletePatient = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeletePatient = async () => {
    if (!patient) return;

    try {
      setIsDeletingPatient(true);

      // Delete all patient photos first
      for (const photo of photos) {
        try {
          await photoService.deletePhoto(photo.id);
        } catch (error) {
          console.warn('Failed to delete photo:', photo.id, error);
        }
      }

      // Delete the patient
      await patientService.deletePatient(patient.id);

      toast({
        title: "Patient record deleted",
        description: `The patient record for "${patient.name}" and all associated photos have been deleted.`,
        variant: "success",
      });
      setShowDeleteConfirm(false);
      onBack(); // Go back to patient list

    } catch (error) {
      console.error('Failed to delete patient:', error);
      toast({
        title: "Failed to delete patient",
        description: "There was an error deleting the patient record. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingPatient(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading patient details...</p>
        </div>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={onBack} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Patients
        </Button>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error || 'Patient not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack} size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{patient.name}</h1>
          <p className="text-muted-foreground">Patient Details & Photo Management</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => setShowCaptureDialog(true)}
        >
          <Camera className="h-4 w-4" />
          Capture Photo
        </Button>
      </div>

      {/* Patient Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Patient Information
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEditDialog(true)}
                className="flex items-center gap-2"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeletePatient}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Date of Birth</p>
              <p className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {formatDate(patient.dateOfBirth)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Assigned Doctor</p>
              <p className="font-medium">Dr. {patient.assignedDoctor}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="flex items-center gap-2">
                {patient.isUrgent && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-medium">
                    <span className="h-2 w-2 rounded-full bg-red-500"></span>
                    Urgent
                  </span>
                )}
                {patient.followUpDate && (
                  <span className="text-sm">
                    Follow-up: {formatDate(patient.followUpDate)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {patient.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{patient.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Body Parts Sidebar */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FolderTree className="h-5 w-5" />
              Body Parts
            </CardTitle>
            <CardDescription>
              {bodyParts.length} categories, {photos.length} photos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant={selectedBodyPart === null ? 'default' : 'outline'}
              className="w-full justify-start"
              onClick={() => setSelectedBodyPart(null)}
            >
              <ImageIcon className="h-4 w-4 mr-2" />
              All Photos ({photos.length})
            </Button>
            {bodyParts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No body parts yet. Add photos to create categories.
              </div>
            ) : (
              bodyParts.map((bodyPart) => {
                const photoCount = getPhotoCountForBodyPart(bodyPart.id);
                return (
                  <Button
                    key={bodyPart.id}
                    variant={selectedBodyPart === bodyPart.id ? 'default' : 'outline'}
                    className="w-full justify-between"
                    onClick={() => setSelectedBodyPart(bodyPart.id)}
                  >
                    <span className="truncate">{bodyPart.name}</span>
                    <span className="ml-2 text-xs opacity-70">({photoCount})</span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Photo Grid */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Photos
              {selectedBodyPart && (
                <span className="text-sm font-normal text-muted-foreground">
                  - {bodyParts.find(bp => bp.id === selectedBodyPart)?.name}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {filteredPhotos.length} photo{filteredPhotos.length !== 1 ? 's' : ''} available
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredPhotos.length === 0 ? (
              <div className="text-center py-12">
                <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No photos yet</h3>
                <p className="text-muted-foreground mb-4">
                  {selectedBodyPart
                    ? 'No photos for this body part'
                    : 'Start by capturing your first photo'}
                </p>
                <Button onClick={() => setShowCaptureDialog(true)}>
                  <Camera className="h-4 w-4 mr-2" />
                  Capture Photo
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {filteredPhotos.map((photo) => {
                  const bodyPartName = bodyParts.find(bp => bp.id === photo.bodyPartCategoryId)?.name;
                  return (
                    <PhotoThumbnail
                      key={photo.id}
                      photo={photo}
                      bodyPartName={bodyPartName}
                      onPhotoClick={handlePhotoClick}
                      onPhotoDelete={handlePhotoDelete}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stats Footer */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <span>Patient added {formatDate(patient.createdAt)}</span>
            <span>Last updated {formatDate(patient.updatedAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Photo Capture Dialog */}
      <PhotoCaptureDialog
        open={showCaptureDialog}
        onOpenChange={setShowCaptureDialog}
        patientId={patientId}
        bodyParts={bodyParts}
        onPhotoSaved={handlePhotoSaved}
      />

      {/* Photo Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Photo"
        description={`Are you sure you want to delete this photo? This action cannot be undone.${
          photoToDelete?.description ? `\n\nDescription: ${photoToDelete.description}` : ''
        }`}
        confirmText="Delete Photo"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmDeletePhoto}
        isConfirming={isDeleting}
      />

      {/* Photo Detail Dialog */}
      <PhotoDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        photo={selectedPhoto}
        bodyPartName={selectedPhoto ? bodyParts.find(bp => bp.id === selectedPhoto.bodyPartCategoryId)?.name : undefined}
        patientName={patient?.name}
      />

      {/* Patient Edit Dialog */}
      <PatientEditDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        patient={patient}
        onPatientUpdated={handlePatientUpdated}
      />

      {/* Patient Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Patient Record"
        description={`Are you sure you want to delete the patient record for "${patient?.name}"? This action cannot be undone and will also delete all ${photos.length} associated photos and medical records.`}
        confirmText="Delete Patient"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmDeletePatient}
        isConfirming={isDeletingPatient}
      />
    </div>
  );
}
