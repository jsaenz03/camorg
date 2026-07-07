/**
 * PhotoTimeline Component
 *
 * Bento grid of photos for a patient, newest first. Image-forward tiles,
 * a body-part filter, and an optional "jump to date" calendar filter. The
 * newest photo is featured (spans 2×2).
 */

'use client';

import { useState, useMemo } from 'react';
import { format, isSameDay } from 'date-fns';
import { Images, FilterX, Calendar as CalendarIcon } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import { BodyPartLabels, BODY_PARTS } from '@/types/body-part';
import { PhotoBento } from './photo-bento';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface PhotoTimelineProps {
  photos: PhotoRecord[];
  onPhotoClick?: (photo: PhotoRecord) => void;
  showFilter?: boolean;
}

export function PhotoTimeline({
  photos,
  onPhotoClick,
  showFilter = true,
}: PhotoTimelineProps) {
  const [bodyPartFilter, setBodyPartFilter] = useState<BodyPart | 'all'>('all');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  const filteredPhotos = useMemo(() => {
    return photos.filter((photo) => {
      if (bodyPartFilter !== 'all' && photo.bodyPart !== bodyPartFilter) return false;
      if (selectedDate && !isSameDay(photo.capturedAt, selectedDate)) return false;
      return true;
    });
  }, [photos, bodyPartFilter, selectedDate]);

  if (photos.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No photos yet"
        description="Capture your first photo to see it here"
      />
    );
  }

  if (filteredPhotos.length === 0 && (bodyPartFilter !== 'all' || selectedDate)) {
    return (
      <div className="space-y-4">
        {showFilter && (
          <FilterBar
            bodyPart={bodyPartFilter}
            onBodyPartChange={setBodyPartFilter}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            count={0}
          />
        )}
        <EmptyState
          icon={FilterX}
          title="No photos found"
          description="No photos match the selected filters"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBodyPartFilter('all');
                setSelectedDate(undefined);
              }}
            >
              Clear filters
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showFilter && (
        <FilterBar
          bodyPart={bodyPartFilter}
          onBodyPartChange={setBodyPartFilter}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          count={filteredPhotos.length}
        />
      )}
      <PhotoBento photos={filteredPhotos} onPhotoClick={onPhotoClick} />
    </div>
  );
}

function FilterBar({
  bodyPart,
  onBodyPartChange,
  selectedDate,
  onDateChange,
  count,
}: {
  bodyPart: BodyPart | 'all';
  onBodyPartChange: (next: BodyPart | 'all') => void;
  selectedDate?: Date;
  onDateChange: (next: Date | undefined) => void;
  count: number;
}) {
  const hasFilters = bodyPart !== 'all' || selectedDate !== undefined;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">
        Timeline{' '}
        <span className="text-muted-foreground">
          ({count} {count === 1 ? 'photo' : 'photos'})
        </span>
      </h2>

      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(selectedDate && 'border-primary text-primary')}
            >
              <CalendarIcon className="size-4" />
              {selectedDate ? format(selectedDate, 'd MMM yyyy') : 'Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={onDateChange}
            />
          </PopoverContent>
        </Popover>

        <Select value={bodyPart} onValueChange={(v) => onBodyPartChange(v as BodyPart | 'all')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Body part" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All body parts</SelectItem>
            {BODY_PARTS.map((part) => (
              <SelectItem key={part} value={part}>
                {BodyPartLabels[part]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onBodyPartChange('all');
              onDateChange(undefined);
            }}
          >
            <FilterX className="size-4" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
