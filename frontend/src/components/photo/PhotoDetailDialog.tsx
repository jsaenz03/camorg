import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileSystemService } from '@/services/file-system-service';
import type { Photo } from '@/models/photo';
import { Calendar, Download, Image as ImageIcon, User, AlertTriangle, Clock, FileImage } from 'lucide-react';

interface PhotoDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: Photo | null;
  bodyPartName?: string;
  patientName?: string;
}

export function PhotoDetailDialog({
  open,
  onOpenChange,
  photo,
  bodyPartName,
  patientName,
}: PhotoDetailDialogProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileSystemService = new FileSystemService();

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const loadImageUrl = async () => {
    if (!photo) return;

    try {
      setLoading(true);
      setError(null);

      // Load the full image for detail view
      const imageBlob = await fileSystemService.loadPhoto(photo.filePath);

      if (imageBlob) {
        const url = URL.createObjectURL(imageBlob);
        setImageUrl(url);
      } else {
        setError('Image not available');
      }
    } catch (err) {
      console.error('Failed to load image:', err);
      setError('Failed to load image');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!photo) return;

    try {
      const imageBlob = await fileSystemService.loadPhoto(photo.filePath);
      if (imageBlob) {
        const url = URL.createObjectURL(imageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = photo.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to download photo:', err);
      setError('Failed to download photo');
    }
  };

  // Load image when dialog opens and photo changes
  useEffect(() => {
    if (open && photo) {
      loadImageUrl();
    }

    // Cleanup blob URL when dialog closes or photo changes
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
        setImageUrl(null);
      }
    };
  }, [open, photo?.id]);

  if (!photo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Photo Details
          </DialogTitle>
          <DialogDescription>
            Detailed view of patient photo with metadata
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Image Display */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Photo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  {loading && (
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                    </div>
                  )}

                  {error && !loading && (
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                      <div className="text-center">
                        <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        <p className="text-destructive">{error}</p>
                      </div>
                    </div>
                  )}

                  {imageUrl && !loading && !error && (
                    <img
                      src={imageUrl}
                      alt={photo.description || 'Patient photo'}
                      className="w-full rounded-lg shadow-lg"
                    />
                  )}

                  {/* Urgent indicator */}
                  {photo.isUrgent && (
                    <div className="absolute top-4 right-4">
                      <div className="bg-red-500 text-white px-3 py-2 rounded-full flex items-center gap-2 shadow-lg">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium">Urgent</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Download button */}
                <div className="mt-4">
                  <Button onClick={handleDownload} className="w-full flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    Download Original Image
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Photo Information */}
          <div className="space-y-4">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Patient Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {patientName && (
                  <div>
                    <p className="text-sm text-muted-foreground">Patient Name</p>
                    <p className="font-medium">{patientName}</p>
                  </div>
                )}
                {bodyPartName && (
                  <div>
                    <p className="text-sm text-muted-foreground">Body Part</p>
                    <p className="font-medium text-blue-600">{bodyPartName}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Patient ID</p>
                  <p className="font-mono text-sm">{photo.patientId}</p>
                </div>
              </CardContent>
            </Card>

            {/* Capture Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Capture Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Capture Date & Time</p>
                  <p className="font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {formatDate(photo.captureDate)}
                  </p>
                </div>
                {photo.description && (
                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p className="font-medium">{photo.description}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Urgent</p>
                  <p className="font-medium">
                    {photo.isUrgent ? (
                      <span className="text-red-600 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Yes - Urgent
                      </span>
                    ) : (
                      <span className="text-green-600">No - Routine</span>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Technical Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileImage className="h-5 w-5" />
                  Technical Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">File Name</p>
                  <p className="font-mono text-sm">{photo.fileName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">File Size</p>
                  <p className="font-medium">{formatFileSize(photo.fileSize)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Dimensions</p>
                  <p className="font-medium">{photo.width} × {photo.height} pixels</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Format</p>
                  <p className="font-medium">{photo.mimeType.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">File Path</p>
                  <p className="font-mono text-xs bg-muted p-2 rounded">{photo.filePath}</p>
                </div>
              </CardContent>
            </Card>

            {/* Metadata */}
            {photo.metadata && Object.keys(photo.metadata).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Additional Metadata</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm bg-muted p-3 rounded overflow-x-auto">
                    {JSON.stringify(photo.metadata, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}