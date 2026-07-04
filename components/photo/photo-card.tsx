/**
 * PhotoCard Component
 *
 * Displays a single photo with metadata in timeline or search results.
 * Shows thumbnail, capture date, body part, subpart, and clinical notes preview.
 */

'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { photoService } from '@/lib/services/photo-service';
import { formatCaptureDate } from '@/lib/utils/date-formatting';

interface PhotoCardProps {
  photo: PhotoRecord;
  onClick?: () => void;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onSelectionChange?: (selected: boolean) => void;
}

/**
 * PhotoCard displays a photo thumbnail with metadata
 */
export function PhotoCard({
  photo,
  onClick,
  isSelected = false,
  showCheckbox = false,
  onSelectionChange,
}: PhotoCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load thumbnail
  useEffect(() => {
    let mounted = true;

    async function loadThumbnail() {
      try {
        const url = await photoService.exportPhotoAsDataUrl(photo.id, true);
        if (mounted) {
          setThumbnailUrl(url);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to load thumbnail'));
          setIsLoading(false);
        }
      }
    }

    loadThumbnail();

    return () => {
      mounted = false;
      // Revoke object URL if it was created
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [photo.id]);

  const handleCardClick = () => {
    if (showCheckbox && onSelectionChange) {
      onSelectionChange(!isSelected);
    } else if (onClick) {
      onClick();
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (onSelectionChange) {
      onSelectionChange(e.target.checked);
    }
  };

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-primary' : ''
      }`}
      onClick={handleCardClick}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {formatCaptureDate(photo.capturedAt)}
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge variant="secondary">{photo.bodyPart}</Badge>
              {photo.subpart && (
                <Badge variant="outline">{photo.subpart}</Badge>
              )}
            </div>
          </div>
          {showCheckbox && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={handleCheckboxChange}
              className="size-5 rounded border-input text-primary accent-primary focus:ring-2 focus:ring-ring focus:ring-offset-0"
              aria-label={`Select photo from ${formatCaptureDate(photo.capturedAt)}`}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {/* Thumbnail */}
        <div className="relative aspect-square w-full bg-muted rounded-md overflow-hidden mb-2">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Failed to load image
            </div>
          )}
          {thumbnailUrl && !isLoading && !error && (
            <img
              src={thumbnailUrl}
              alt={`Photo of ${photo.bodyPart}${photo.subpart ? ` - ${photo.subpart}` : ''}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )}
        </div>

        {/* Clinical Notes Preview */}
        {photo.clinicalNotes && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {photo.clinicalNotes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
