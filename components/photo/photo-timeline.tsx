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
  const [seriesFilter, setSeriesFilter] = useState<string | 'all'>('all');
  const [attachmentsFilter, setAttachmentsFilter] = useState<'all' | 'with' | 'without'>('all');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  // Lesion series present in the (already access-filtered) photo set.
  const seriesOptions = useMemo(
    () =>
      [...new Set(photos.map((p) => p.lesionGroup).filter((g): g is string => !!g))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [photos],
  );

  const filteredPhotos = useMemo(() => {
    return photos.filter((photo) => {
      if (bodyPartFilter !== 'all' && photo.bodyPart !== bodyPartFilter) return false;
      if (seriesFilter !== 'all' && photo.lesionGroup !== seriesFilter) return false;
      if (
        attachmentsFilter !== 'all' &&
        (photo.attachmentCount > 0) !== (attachmentsFilter === 'with')
      ) {
        return false;
      }
      if (selectedDate && !isSameDay(photo.capturedAt, selectedDate)) return false;
      return true;
    });
  }, [photos, bodyPartFilter, seriesFilter, attachmentsFilter, selectedDate]);

  if (photos.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No photos yet"
        description="Capture your first photo to see it here"
      />
    );
  }

  const hasActiveFilters =
    bodyPartFilter !== 'all' || seriesFilter !== 'all' || attachmentsFilter !== 'all' || selectedDate !== undefined;

  if (filteredPhotos.length === 0 && hasActiveFilters) {
    return (
      <div className="space-y-4">
        {showFilter && (
          <FilterBar
            bodyPart={bodyPartFilter}
            onBodyPartChange={setBodyPartFilter}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            series={seriesFilter}
            onSeriesChange={setSeriesFilter}
            seriesOptions={seriesOptions}
            attachments={attachmentsFilter}
            onAttachmentsChange={setAttachmentsFilter}
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
                setSeriesFilter('all');
                setAttachmentsFilter('all');
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
          series={seriesFilter}
          onSeriesChange={setSeriesFilter}
          seriesOptions={seriesOptions}
          attachments={attachmentsFilter}
          onAttachmentsChange={setAttachmentsFilter}
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
  onDateChange,
  selectedDate,
  series,
  onSeriesChange,
  seriesOptions,
  attachments,
  onAttachmentsChange,
  count,
}: {
  bodyPart: BodyPart | 'all';
  onBodyPartChange: (next: BodyPart | 'all') => void;
  selectedDate?: Date;
  onDateChange: (next: Date | undefined) => void;
  series: string | 'all';
  onSeriesChange: (next: string | 'all') => void;
  seriesOptions: string[];
  attachments: 'all' | 'with' | 'without';
  onAttachmentsChange: (next: 'all' | 'with' | 'without') => void;
  count: number;
}) {
  const hasFilters =
    bodyPart !== 'all' || series !== 'all' || attachments !== 'all' || selectedDate !== undefined;

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

        {seriesOptions.length > 0 && (
          <Select value={series} onValueChange={onSeriesChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Lesion series" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lesion series</SelectItem>
              {seriesOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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

        <Select value={attachments} onValueChange={(v) => onAttachmentsChange(v as 'all' | 'with' | 'without')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Attachments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All photos</SelectItem>
            <SelectItem value="with">With attachments</SelectItem>
            <SelectItem value="without">Without attachments</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onBodyPartChange('all');
              onSeriesChange('all');
              onAttachmentsChange('all');
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
