/**
 * PhotosOverTimeChart
 *
 * Area chart of photos captured per day over the trailing N days.
 * Fed by useAllPhotos; buckets by capturedAt's calendar day.
 */

'use client';

import { useMemo, useState } from 'react';
import { format, startOfDay, subDays, isAfter, isEqual } from 'date-fns';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { PhotoWithPatient } from '@/lib/hooks/use-all-photos';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EmptyState } from '@/components/empty-state';
import { Images } from 'lucide-react';

interface PhotosOverTimeChartProps {
  photos: PhotoWithPatient[];
}

const RANGE_OPTIONS = [
  { value: '7', days: 7 },
  { value: '30', days: 30 },
  { value: '90', days: 90 },
] as const;

const chartConfig = {
  count: { label: 'Photos', color: 'var(--chart-2)' },
} satisfies ChartConfig;

export function PhotosOverTimeChart({ photos }: PhotosOverTimeChartProps) {
  const [range, setRange] = useState<string>('30');
  const days = RANGE_OPTIONS.find((o) => o.value === range)?.days ?? 30;

  const data = useMemo(() => {
    const today = startOfDay(new Date());
    const start = subDays(today, days - 1);
    const buckets = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const key = format(subDays(today, i), 'yyyy-MM-dd');
      buckets.set(key, 0);
    }
    for (const photo of photos) {
      const day = startOfDay(photo.capturedAt);
      if (isAfter(day, today) || isEqual(day, today)) {
        if (!isAfter(day, today)) {
          const key = format(day, 'yyyy-MM-dd');
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
      } else if (!isAfter(start, day)) {
        const key = format(day, 'yyyy-MM-dd');
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    return Array.from(buckets.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [photos, days]);

  const isEmpty = data.every((d) => d.count === 0);

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Photos captured</CardTitle>
          <CardDescription>Daily capture activity</CardDescription>
        </div>
        <ToggleGroup
          type="single"
          value={range}
          onValueChange={(v) => v && setRange(v)}
          size="sm"
          variant="outline"
        >
          {RANGE_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value}>
              {o.value}d
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <div className="flex h-[220px] items-center justify-center">
            <EmptyState
              icon={Images}
              title="No captures in this range"
              description="Photos captured in the last {days} days will chart here."
            />
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="photosFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(value) => format(new Date(value), 'd MMM')}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date
                        ? format(new Date(payload[0].payload.date), 'EEEE, d MMM yyyy')
                        : ''
                    }
                  />
                }
              />
              <Area
                dataKey="count"
                type="monotone"
                stroke="var(--color-count)"
                strokeWidth={2}
                fill="url(#photosFill)"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
