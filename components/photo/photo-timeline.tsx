/**
 * PhotoTimeline Component
 *
 * Displays photos in chronological order (newest first) with virtual scrolling for performance.
 * Supports body part filtering and empty state.
 */

'use client';

import { useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { Images, FilterX } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import { PhotoCard } from './photo-card';
import { EmptyState } from '@/components/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BODY_PARTS } from '@/types/body-part';

interface PhotoTimelineProps {
  photos: PhotoRecord[];
  onPhotoClick?: (photo: PhotoRecord) => void;
  showFilter?: boolean;
  showSelection?: boolean;
  selectedPhotoIds?: Set<string>;
  onSelectionChange?: (photoId: string, selected: boolean) => void;
}

/**
 * PhotoTimeline displays a chronological list of photos with optional filtering
 */
export function PhotoTimeline({
  photos,
  onPhotoClick,
  showFilter = true,
  showSelection = false,
  selectedPhotoIds = new Set(),
  onSelectionChange,
}: PhotoTimelineProps) {
  const [bodyPartFilter, setBodyPartFilter] = useState<BodyPart | 'all'>('all');
  const parentRef = useRef<HTMLDivElement>(null);

  // Filter photos by body part
  const filteredPhotos = useMemo(() => {
    if (bodyPartFilter === 'all') {
      return photos;
    }
    return photos.filter((photo) => photo.bodyPart === bodyPartFilter);
  }, [photos, bodyPartFilter]);

  // Virtual scrolling configuration
  const rowVirtualizer = useVirtualizer({
    count: filteredPhotos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 320, // Estimated height of a photo card
    overscan: 5, // Render 5 extra items above and below viewport
  });

  // Empty state
  if (photos.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No photos yet"
        description="Capture your first photo to see it here"
      />
    );
  }

  // Empty state after filtering
  if (filteredPhotos.length === 0 && bodyPartFilter !== 'all') {
    return (
      <div className="space-y-4">
        {showFilter && (
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Timeline</h2>
            <Select value={bodyPartFilter} onValueChange={(value) => setBodyPartFilter(value as BodyPart | 'all')}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by body part" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All body parts</SelectItem>
                {BODY_PARTS.map((part) => (
                  <SelectItem key={part} value={part}>
                    {part}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <EmptyState
          icon={FilterX}
          title="No photos found"
          description="No photos match the selected body part filter"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Header */}
      {showFilter && (
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">
            Timeline ({filteredPhotos.length} {filteredPhotos.length === 1 ? 'photo' : 'photos'})
          </h2>
          <Select value={bodyPartFilter} onValueChange={(value) => setBodyPartFilter(value as BodyPart | 'all')}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by body part" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All body parts</SelectItem>
              {BODY_PARTS.map((part) => (
                <SelectItem key={part} value={part}>
                  {part}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Virtual Scrolling Container */}
      <div
        ref={parentRef}
        className="h-[600px] overflow-auto rounded-lg border bg-card"
        style={{ contain: 'strict' }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const photo = filteredPhotos[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="p-4">
                  <PhotoCard
                    photo={photo}
                    onClick={() => onPhotoClick?.(photo)}
                    showCheckbox={showSelection}
                    isSelected={selectedPhotoIds.has(photo.id)}
                    onSelectionChange={(selected) => onSelectionChange?.(photo.id, selected)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selection Info */}
      {showSelection && selectedPhotoIds.size > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          {selectedPhotoIds.size} photo{selectedPhotoIds.size === 1 ? '' : 's'} selected
          {selectedPhotoIds.size >= 2 && selectedPhotoIds.size <= 4 && (
            <span className="ml-2 text-primary">Ready to compare</span>
          )}
          {selectedPhotoIds.size > 4 && (
            <span className="ml-2 text-destructive">Maximum 4 photos for comparison</span>
          )}
        </div>
      )}
    </div>
  );
}
