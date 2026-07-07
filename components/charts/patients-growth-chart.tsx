/**
 * PatientsGrowthChart
 *
 * Cumulative patient count over time (by createdAt). Area chart so the growth
 * reads as a rising curve.
 */

'use client';

import { useMemo } from 'react';
import { format, startOfDay } from 'date-fns';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { Patient } from '@/types/patient';
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
import { Users } from 'lucide-react';

interface PatientsGrowthChartProps {
  patients: Patient[];
}

const chartConfig = {
  total: { label: 'Patients', color: 'var(--chart-1)' },
} satisfies ChartConfig;

export function PatientsGrowthChart({ patients }: PatientsGrowthChartProps) {
  const { data, isEmpty } = useMemo(() => {
    if (patients.length === 0) {
      return { data: [], isEmpty: true };
    }
    // Cumulative curve anchored on every day that has an event, plus today.
    const events = patients
      .map((p) => startOfDay(p.createdAt).getTime())
      .sort((a, b) => a - b);
    const first = events[0];
    const today = startOfDay(new Date()).getTime();
    const end = Math.max(today, events[events.length - 1]);

    const dailyCounts = new Map<number, number>();
    for (const ts of events) {
      dailyCounts.set(ts, (dailyCounts.get(ts) ?? 0) + 1);
    }

    const points: { date: string; total: number }[] = [];
    let running = 0;
    for (let day = first; day <= end; day += 24 * 60 * 60 * 1000) {
      running += dailyCounts.get(day) ?? 0;
      points.push({ date: format(new Date(day), 'yyyy-MM-dd'), total: running });
    }
    // Guarantee the final point is "today" so the curve reaches the present.
    if (points.length === 0 || points[points.length - 1].date !== format(new Date(today), 'yyyy-MM-dd')) {
      points.push({ date: format(new Date(today), 'yyyy-MM-dd'), total: running });
    }
    return { data: points, isEmpty: false };
  }, [patients]);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">Patient growth</CardTitle>
        <CardDescription>Cumulative patients registered</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <div className="flex h-[220px] items-center justify-center">
            <EmptyState
              icon={Users}
              title="No patients yet"
              description="Patient registrations will accumulate on this chart."
            />
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="patientsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
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
                        ? format(new Date(payload[0].payload.date), 'd MMM yyyy')
                        : ''
                    }
                  />
                }
              />
              <Area
                dataKey="total"
                type="stepAfter"
                stroke="var(--color-total)"
                strokeWidth={2}
                fill="url(#patientsFill)"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
