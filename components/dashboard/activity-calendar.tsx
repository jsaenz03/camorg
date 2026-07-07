/**
 * ActivityCalendar
 *
 * shadcn Calendar that highlights days with photo captures. Selecting a day
 * calls back so the parent can filter (e.g. show that day's photos). Capture
 * counts render as a small dot under the day number; the selected day is
 * reset when the parent clears its filter.
 */

'use client';

import { useMemo } from 'react';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PhotoWithPatient } from '@/lib/hooks/use-all-photos';
import { cn } from '@/lib/utils';

interface ActivityCalendarProps {
  photos: PhotoWithPatient[];
  selectedDate?: Date | null;
  onSelectDate?: (date: Date | null) => void;
}

export function ActivityCalendar({
  photos,
  selectedDate,
  onSelectDate,
}: ActivityCalendarProps) {
  // Map of capture day -> count, for both the modifier set and the badge.
  const dayCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const photo of photos) {
      const key = photo.capturedAt.toDateString();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [photos]);

  const capturedDays = useMemo(
    () =>
      Array.from(dayCount.keys()).map((s) => {
        const [m, d, y] = s.split(' ');
        return new Date(`${m} ${d}, ${y}`);
      }),
    [dayCount],
  );

  function handleSelect(day: Date | undefined) {
    onSelectDate?.(day ?? null);
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">Capture activity</CardTitle>
        <CardDescription>
          {capturedDays.length} active {capturedDays.length === 1 ? 'day' : 'days'} · click a day to filter
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <Calendar
          mode="single"
          selected={selectedDate ?? undefined}
          onSelect={handleSelect}
          modifiers={{ captured: capturedDays }}
          className="mx-auto"
          classNames={{
            day: cn(
              'relative',
              '[&[data-captured=true]::after]:absolute [&[data-captured=true]::after]:bottom-1 [&[data-captured=true]::after]:left-1/2 [&[data-captured=true]::after]:size-1 [&[data-captured=true]::after]:-translate-x-1/2 [&[data-captured=true]::after]:rounded-full [&[data-captured=true]::after]:bg-primary',
            ),
          }}
          components={{
            DayButton: ({ day, ...props }) => {
              const count = dayCount.get(day.date.toDateString());
              return (
                <button
                  {...props}
                  data-captured={count ? 'true' : undefined}
                  title={count ? `${count} ${count === 1 ? 'photo' : 'photos'}` : undefined}
                >
                  {day.date.getDate()}
                </button>
              );
            },
          }}
        />
      </CardContent>
    </Card>
  );
}
