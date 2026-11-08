/**
 * PhotoTimeline Component
 *
 * Bento grid of photos for a patient, newest first. Image-forward tiles,
 * a body-part filter, and an optional "jump to date" calendar filter. The
 * newest photo is featured (spans 2×2).
 */

'use client';

import { useState, useMemo, useEffect } from 'react';
import { format } from 'date-fns';
import { Images, FilterX, Calendar as CalendarIcon } from 'lucide-react';
import type { PhotoRecord } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import { BodyPartLabels, BODY_PARTS } from '@/types/body-part';
import { applyTimelineFilter, type TimelineFilter } from '@/lib/utils/timeline-filter';
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
  /** Fires on mount and whenever the filters change (all-off included).
      The patient page carries it to the case report so the report — and its
      print — cover exactly the photos the grid is showing. */
  onFilterChange?: (filter: TimelineFilter) => void;
}

/** Select sentinel for the "not in a series" option — never a real series
    name, which is free text and could otherwise collide. */
const SERIES_NONE = '__unlinked__';

export function PhotoTimeline({
  photos,
  onPhotoClick,
  showFilter = true,
  onFilterChange,
}: PhotoTimelineProps) {
  const [bodyPartFilter, setBodyPartFilter] = useState<BodyPart | 'all'>('all');
  const [seriesFilter, setSeriesFilter] = useState<string | 'all' | typeof SERIES_NONE>('all');
  const [attachmentsFilter, setAttachmentsFilter] = useState<'all' | 'with' | 'without'>('all');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  // ⌘/Ctrl multi-select feeding drag-the-selection linking. Held as ids;
  // resolved against the filtered set so filtered-out tiles drop out of the
  // carry instead of silently linking from another filter's context.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Lesion series present in the (already access-filtered) photo set.
  const seriesOptions = useMemo(
    () =>
      [...new Set(photos.map((p) => p.lesionGroup).filter((g): g is string => !!g))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [photos],
  );

  const filter = useMemo<TimelineFilter>(
    () => ({
      series: seriesFilter === 'all' || seriesFilter === SERIES_NONE ? null : seriesFilter,
      unlinked: seriesFilter === SERIES_NONE,
      bodyPart: bodyPartFilter === 'all' ? null : bodyPartFilter,
      attachments: attachmentsFilter,
      date: selectedDate ?? null,
    }),
    [seriesFilter, bodyPartFilter, attachmentsFilter, selectedDate],
  );

  const filteredPhotos = useMemo(
    () => applyTimelineFilter(photos, filter),
    [photos, filter],
  );

  // Report the active filter upward — the Report button turns it into the
  // query params that make the case report follow the grid.
  useEffect(() => {
    onFilterChange?.(filter);
  }, [filter, onFilterChange]);

  const selection = useMemo(
    () => filteredPhotos.filter((p) => selectedIds.has(p.id)),
    [filteredPhotos, selectedIds],
  );

  // Escape deselects — the manual way out of a half-built link drop. An
  // Escape already consumed by an open dialog (defaultPrevented) leaves the
  // selection alone.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setSelectedIds(new Set());
        // The last ⌘/Ctrl-clicked tile keeps focus after the clear, and
        // Chromium paints its :focus-visible ring from the Escape keydown
        // itself — same colour as the selection ring (--ring is --primary),
        // so the tile reads as "one still selected". Release it too.
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.hasAttribute('data-photo-id')) {
          active.blur();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds.size]);

  function toggleSelected(photoId: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }

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
      <PhotoBento
        photos={filteredPhotos}
        onPhotoClick={onPhotoClick}
        selection={selection}
        onSelectionChange={(photo, selected) => toggleSelected(photo.id, selected)}
        onSaved={() => setSelectedIds(new Set())}
      />
      {filteredPhotos.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Tip: ⌘-click (Ctrl on Windows) photos — or Ctrl-drag a box over them — to select several,
          then drag one onto another to link them all as one series. Escape (or a click on empty
          space) clears the selection.
        </p>
      )}
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
  series: string | 'all' | typeof SERIES_NONE;
  onSeriesChange: (next: string | 'all' | typeof SERIES_NONE) => void;
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
              <SelectItem value={SERIES_NONE}>Not in a series</SelectItem>
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
