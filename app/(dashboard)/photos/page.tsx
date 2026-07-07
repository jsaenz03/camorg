'use client';

/**
 * Photos page.
 *
 * Cross-patient photo browser. A left filter rail (shadcn Calendar for a
 * single-day filter, body-part Select, patient Select) narrows an asymmetric
 * bento grid of all photos. Clicking a photo opens the detail dialog.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Images, FilterX, Camera } from 'lucide-react';
import { useAllPhotos } from '@/lib/hooks/use-all-photos';
import { usePatients } from '@/lib/hooks/use-patients';
import { BODY_PARTS, BodyPartLabels } from '@/types/body-part';
import type { BodyPart } from '@/types/body-part';
import type { PhotoRecord } from '@/types/photo';
import { isSameDay } from 'date-fns';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { PhotoBento } from '@/components/photo/photo-bento';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PhotosPage() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [bodyPart, setBodyPart] = useState<BodyPart | 'all'>('all');
  const [patientId, setPatientId] = useState<string | 'all'>('all');

  const [activePhoto, setActivePhoto] = useState<PhotoRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Load once (broad), then filter client-side so switching filters is instant.
  const { photos, isLoading, refresh } = useAllPhotos({ limit: 500 });
  const { patients } = usePatients({ includeArchived: false });

  const filtered = useMemo(() => {
    return photos.filter((photo) => {
      if (selectedDate && !isSameDay(photo.capturedAt, selectedDate)) return false;
      if (bodyPart !== 'all' && photo.bodyPart !== bodyPart) return false;
      if (patientId !== 'all' && photo.patientId !== patientId) return false;
      return true;
    });
  }, [photos, selectedDate, bodyPart, patientId]);

  const hasFilters =
    selectedDate !== undefined || bodyPart !== 'all' || patientId !== 'all';

  function clearFilters() {
    setSelectedDate(undefined);
    setBodyPart('all');
    setPatientId('all');
  }

  function handlePhotoClick(photo: PhotoRecord) {
    setActivePhoto(photo);
    setDialogOpen(true);
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Photos"
        description="Browse every capture across all patients."
        actions={
          <Button asChild>
            <Link href="/capture">
              <Camera className="size-4" />
              Capture
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Filter rail */}
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Date</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                className="mx-auto"
              />
              {selectedDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => setSelectedDate(undefined)}
                >
                  Clear date
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Body part</label>
                <Select
                  value={bodyPart}
                  onValueChange={(v) => setBodyPart(v as BodyPart | 'all')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All body parts" />
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
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Patient</label>
                <Select
                  value={patientId}
                  onValueChange={(v) => setPatientId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All patients" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All patients</SelectItem>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {hasFilters && (
                <Button variant="outline" size="sm" className="w-full" onClick={clearFilters}>
                  <FilterX className="size-4" />
                  Clear filters
                </Button>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* Results */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? 'photo' : 'photos'}
            </p>
          </div>

          {isLoading ? (
            <div className="grid auto-rows-[170px] grid-cols-2 gap-3 sm:auto-rows-[200px] md:grid-cols-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className={i === 0 ? 'col-span-2 row-span-2 rounded-xl' : 'rounded-xl'}
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={hasFilters ? FilterX : Images}
              title={hasFilters ? 'No photos match' : 'No photos yet'}
              description={
                hasFilters
                  ? 'Try widening your filters.'
                  : 'Capture a photo to start building the library.'
              }
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button asChild>
                    <Link href="/capture">
                      <Camera className="size-4" />
                      Capture photo
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <PhotoBento photos={filtered} onPhotoClick={handlePhotoClick} />
          )}
        </section>
      </div>

      <PhotoDetailDialog
        photo={activePhoto}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onChanged={refresh}
      />
    </div>
  );
}
