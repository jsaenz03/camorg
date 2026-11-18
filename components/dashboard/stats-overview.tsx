/**
 * StatsOverview
 *
 * KPI row for the dashboard. Renders compact stat cards from already-loaded
 * patient/photo data — no additional queries. Cards with an `href` navigate
 * (Patients → the patients list, Photos → the photo browser); the slice
 * metrics stay static.
 */

'use client';

import type { LucideIcon } from 'lucide-react';
import { Images, Users, CalendarDays, Activity } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { PhotoSummary } from '@/lib/services/photo-service';
import type { Patient } from '@/types/patient';
import { startOfDay, isSameDay, subDays } from 'date-fns';
import { cn } from '@/lib/utils';

interface StatsOverviewProps {
  patients: Patient[];
  photos: PhotoSummary[];
}

function startOfWeek(): Date {
  // Monday-anchored "this week".
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  return startOfDay(subDays(now, day));
}

export function StatsOverview({ patients, photos }: StatsOverviewProps) {
  const weekStart = startOfWeek();
  const photosThisWeek = photos.filter((p) => p.capturedAt >= weekStart).length;
  const activeThisWeek = new Set(
    photos.filter((p) => p.capturedAt >= weekStart).map((p) => p.patientId),
  ).size;

  const stats: { label: string; value: number; icon: LucideIcon; hint: string; href?: string }[] = [
    { label: 'Patients', value: patients.length, icon: Users, hint: 'Total registered', href: '/patients' },
    { label: 'Photos', value: photos.length, icon: Images, hint: 'All captures', href: '/photos' },
    {
      label: 'This week',
      value: photosThisWeek,
      icon: CalendarDays,
      hint: `${activeThisWeek} active ${activeThisWeek === 1 ? 'patient' : 'patients'}`,
    },
    {
      label: 'Today',
      value: photos.filter((p) => isSameDay(p.capturedAt, new Date())).length,
      icon: Activity,
      hint: 'Captures today',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, hint, href }) => {
        const card = (
          <Card key={label} className={cn(href && 'transition-colors hover:bg-accent/50')}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                {value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        );
        // Navigable cards render as real links (anchor semantics, keyboard
        // and middle-click for free); the focus ring sits on the wrapper so
        // it follows the card's rounded outline.
        return href ? (
          <Link
            key={label}
            href={href}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {card}
          </Link>
        ) : (
          card
        );
      })}
    </div>
  );
}
