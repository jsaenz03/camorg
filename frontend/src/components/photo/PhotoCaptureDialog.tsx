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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PhotoCapture } from './PhotoCapture';
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

      const savedPhoto = await photoService.capturePhoto(captureRequest, {
        quality: 0.9,
        format: 'jpeg',
        maxWidth: 1920,
        maxHeight: 1080,
      });

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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Capture Photo for Patient
          </DialogTitle>
          <DialogDescription>
            Select a body part and capture a photo for documentation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Body Part Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1. Select Body Part</CardTitle>
              <CardDescription>
                Choose the anatomical region being photographed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="body-part">Body Part *</Label>
                  <Select value={selectedBodyPart} onValueChange={setSelectedBodyPart}>
                    <SelectTrigger id="body-part">
                      <SelectValue placeholder="Select a body part" />
                    </SelectTrigger>
                    <SelectContent>
                      {bodyParts.map((bodyPart) => (
                        <SelectItem key={bodyPart.id} value={bodyPart.id}>
                          {bodyPart.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the photo"
                    maxLength={500}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Photo Capture */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">2. Capture Photo</CardTitle>
              <CardDescription>
                {selectedBodyPart
                  ? 'Position the camera and capture the photo'
                  : 'Please select a body part first'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
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
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">{error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Success Indicator */}
          {capturedBlob && !error && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-green-700">
                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  <span className="text-sm">Photo captured successfully! Ready to save.</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSavePhoto}
            disabled={!canSave}
            className="flex items-center gap-2"
          >
            {isCapturing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                Save Photo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}