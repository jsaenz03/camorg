import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PhotoService } from '@/services/photo-service';
import type { Photo } from '@/models/photo';
import { Image as ImageIcon, Download, Trash2, Calendar } from 'lucide-react';

interface PhotoThumbnailProps {
  photo: Photo;
  bodyPartName?: string;
  onPhotoClick?: (photo: Photo) => void;
  onPhotoDelete?: (photo: Photo) => void;
  className?: string;
}

export function PhotoThumbnail({
  photo,
  bodyPartName,
  onPhotoClick,
  onPhotoDelete,
  className = '',
}: PhotoThumbnailProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const photoService = new PhotoService();

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
    try {
      setLoading(true);
      setError(null);

      // Try to load thumbnail first, then full image as fallback
      let imageBlob: Blob;
      try {
        imageBlob = await photoService.loadThumbnailBlob(photo.id);
      } catch {
        // Fallback to full image if thumbnail fails
        imageBlob = await photoService.loadPhotoBlob(photo.id);
      }

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
    try {
      const imageBlob = await photoService.loadPhotoBlob(photo.id);
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

  const handleDelete = () => {
    onPhotoDelete?.(photo);
  };

  const handleClick = () => {
    onPhotoClick?.(photo);
  };

  // Load image when component mounts or photo changes
  useEffect(() => {
    loadImageUrl();

    // Cleanup blob URL when component unmounts or photo changes
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [photo.id]);

  const hasError = error || !imageUrl;

  return (
    <Card className={`overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${className}`}>
      {/* Image Container */}
      <div
        className="aspect-square bg-muted relative overflow-hidden"
        onClick={handleClick}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {hasError && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <ImageIcon className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        {imageUrl && !loading && !hasError && (
          <img
            src={imageUrl}
            alt={photo.description || 'Patient photo'}
            className="w-full h-full object-cover"
            onError={() => {
              setError('Failed to load image');
            }}
          />
        )}

        {/* Urgent indicator */}
        {photo.isUrgent && (
          <div className="absolute top-2 right-2">
            <div className="bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-white"></div>
              Urgent
            </div>
          </div>
        )}
      </div>

      {/* Photo Information */}
      <CardContent className="p-3">
        <div className="space-y-2">
          {/* Date and Time */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(photo.captureDate)}
          </div>

          {/* Body Part */}
          {bodyPartName && (
            <div className="text-sm font-medium text-blue-600">
              {bodyPartName}
            </div>
          )}

          {/* Description */}
          {photo.description && (
            <p className="text-sm truncate" title={photo.description}>
              {photo.description}
            </p>
          )}

          {/* File Info */}
          <div className="text-xs text-muted-foreground">
            {formatFileSize(photo.fileSize)} • {photo.width}×{photo.height}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-3 pt-3 border-t">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8"
            onClick={handleDownload}
          >
            <Download className="h-3 w-3" />
          </Button>
          {onPhotoDelete && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}