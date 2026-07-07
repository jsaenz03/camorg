/**
 * PhotosByBodyPartChart
 *
 * Donut chart of photo counts per body part. Only body parts with at least
 * one photo are rendered; colours cycle through the chart tokens.
 */

'use client';

import { useMemo } from 'react';
import { Cell, Label, Pie, PieChart } from 'recharts';
import type { PhotoWithPatient } from '@/lib/hooks/use-all-photos';
import { BodyPartLabels } from '@/types/body-part';
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
import { EmptyState } from '@/components/empty-state';
import { Images } from 'lucide-react';

interface PhotosByBodyPartChartProps {
  photos: PhotoWithPatient[];
}

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function PhotosByBodyPartChart({ photos }: PhotosByBodyPartChartProps) {
  const { data, config, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of photos) {
      counts.set(photo.bodyPart, (counts.get(photo.bodyPart) ?? 0) + 1);
    }
    const entries = Array.from(counts.entries())
      .map(([part, count]) => ({
        bodyPart: part,
        label: BodyPartLabels[part as keyof typeof BodyPartLabels] ?? part,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const cfg: ChartConfig = {};
    entries.forEach((entry, i) => {
      cfg[entry.bodyPart] = {
        label: entry.label,
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    });
    return { data: entries, config: cfg, total: entries.reduce((s, e) => s + e.count, 0) };
  }, [photos]);

  const isEmpty = data.length === 0;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">By body part</CardTitle>
        <CardDescription>Distribution across capture sites</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <div className="flex h-[220px] items-center justify-center">
            <EmptyState
              icon={Images}
              title="No data yet"
              description="Capture photos to see the body-part breakdown."
            />
          </div>
        ) : (
          <ChartContainer config={config} className="mx-auto h-[220px]">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="bodyPart" hideLabel />} />
              <Pie
                data={data}
                dataKey="count"
                nameKey="bodyPart"
                innerRadius={52}
                outerRadius={80}
                paddingAngle={2}
              >
                {data.map((entry) => (
                  <Cell key={entry.bodyPart} fill={config[entry.bodyPart].color} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !('cx' in viewBox)) return null;
                    const { cx, cy } = viewBox as { cx: number; cy: number };
                    return (
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan
                          x={cx}
                          y={cy}
                          className="fill-foreground text-2xl font-semibold"
                        >
                          {total}
                        </tspan>
                        <tspan
                          x={cx}
                          y={cy + 18}
                          className="fill-muted-foreground text-xs"
                        >
                          photos
                        </tspan>
                      </text>
                    );
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
