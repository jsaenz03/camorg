import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PhotoCapture } from './PhotoCapture';
import { HierarchicalBodyPartSelector } from './HierarchicalBodyPartSelector';
import { PhotoService } from '@/services/photo-service';
import type { BodyPartCategory } from '@/models/body-part';
import type { Photo } from '@/models/photo';
import { Camera, Loader2, AlertCircle } from 'lucide-react';

interface PhotoCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  bodyParts: BodyPartCategory[];
  onPhotoSaved: (photo: Photo) => void;
}

export function PhotoCaptureDialog({
  open,
  onOpenChange,
  patientId,
  bodyParts,
  onPhotoSaved,
}: PhotoCaptureDialogProps) {
  const [selectedBodyPart, setSelectedBodyPart] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const photoService = new PhotoService();

  const handlePhotoCapture = async (imageBlob: Blob) => {
    try {
      setError(null);
      setCapturedBlob(imageBlob);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to capture photo';
      setError(errorMessage);
    }
  };

  const handleCameraError = (errorMessage: string) => {
    setError(errorMessage);
  };

  const handleSavePhoto = async () => {
    if (!selectedBodyPart || !capturedBlob) {
      setError('Please select a body part and capture a photo');
      return;
    }

    try {
      setIsCapturing(true);
      setError(null);

      const captureRequest = {
        patientId,
        bodyPartCategoryId: selectedBodyPart,
        description: description.trim() || undefined,
        isUrgent: false,
      };

      const savedPhoto = await photoService.savePhotoFromBlob(captureRequest, capturedBlob);

      onPhotoSaved(savedPhoto);
      handleClose();

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save photo';
      setError(errorMessage);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleClose = () => {
    setSelectedBodyPart('');
    setDescription('');
    setError(null);
    setCapturedBlob(null);
    onOpenChange(false);
  };

  const canSave = selectedBodyPart && capturedBlob && !isCapturing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[95vh] p-3 sm:p-6 overflow-y-auto">
        <DialogHeader className="pb-2 sm:pb-4">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Camera className="h-4 w-4 sm:h-5 sm:w-5" />
            Capture Photo for Patient
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Select a body part and capture a photo for documentation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-6">
          {/* Body Part Selection */}
          <Card>
            <CardHeader className="pb-2 sm:pb-4 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-sm sm:text-lg">1. Select Body Part Location</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Choose the anatomical region being photographed
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <HierarchicalBodyPartSelector
                bodyParts={bodyParts}
                value={selectedBodyPart}
                onChange={setSelectedBodyPart}
                patientId={patientId}
              />
            </CardContent>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader className="pb-2 sm:pb-4 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-sm sm:text-lg">2. Add Description (Optional)</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Add notes about the condition or area
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="space-y-2">
                <Label htmlFor="description" className="text-xs sm:text-sm">Photo Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="E.g., 'Mole on left shoulder, approximately 5mm diameter...'"
                  maxLength={500}
                  rows={3}
                  className="resize-none text-xs sm:text-sm"
                />
                <div className="text-xs text-muted-foreground text-right">
                  {description.length}/500 characters
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Photo Capture */}
          <Card>
            <CardHeader className="pb-2 sm:pb-4 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-sm sm:text-lg">3. Capture Photo</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                {selectedBodyPart
                  ? 'Position the camera and capture the photo'
                  : 'Please select a body part first'
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <PhotoCapture
                onPhotoCapture={handlePhotoCapture}
                onError={handleCameraError}
                disabled={!selectedBodyPart}
              />
            </CardContent>
          </Card>

          {/* Error Display */}
          {error && (
            <Card className="border-destructive">
              <CardContent className="pt-3 sm:pt-6 pb-3 sm:pb-6 px-3 sm:px-6">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span className="text-xs sm:text-sm">{error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Success Indicator */}
          {capturedBlob && !error && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-3 sm:pt-6 pb-3 sm:pb-6 px-3 sm:px-6">
                <div className="flex items-center gap-2 text-green-700">
                  <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0"></div>
                  <span className="text-xs sm:text-sm">Photo captured successfully! Ready to save.</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
          <Button variant="outline" onClick={handleClose} className="w-full sm:w-auto text-xs sm:text-sm">
            Cancel
          </Button>
          <Button
            onClick={handleSavePhoto}
            disabled={!canSave}
            className="flex items-center gap-2 w-full sm:w-auto text-xs sm:text-sm"
          >
            {isCapturing ? (
              <>
                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Camera className="h-3 w-3 sm:h-4 sm:w-4" />
                Save Photo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}