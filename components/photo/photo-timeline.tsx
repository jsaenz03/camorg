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
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import { PhotoCard } from './photo-card';
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
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">No photos yet</h3>
        <p className="text-sm text-muted-foreground">
          Capture your first photo to see it here
        </p>
      </div>
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
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">No photos found</h3>
          <p className="text-sm text-muted-foreground">
            No photos match the selected body part filter
          </p>
        </div>
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
