'use client';

/**
 * Home dashboard.
 *
 * Stats overview → charts (photos over time, by body part, patient growth) →
 * capture activity calendar → recent patients bento → latest photos bento.
 * Auth is intentionally bypassed (see DashboardLayout); we still surface the
 * clinician name from useAuth when present.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, Images, Users, ArrowRight } from 'lucide-react';
import type { Patient } from '@/types/patient';
import type { BodyPart } from '@/types/body-part';
import { BodyPartLabels } from '@/types/body-part';
import { patientService } from '@/lib/services/patient-service';
import { photoService } from '@/lib/services/photo-service';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/utils/date-formatting';
import { isSameDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { StatsOverview } from '@/components/dashboard/stats-overview';
import { ActivityCalendar } from '@/components/dashboard/activity-calendar';
import { PhotosOverTimeChart } from '@/components/charts/photos-over-time-chart';
import { PhotosByBodyPartChart } from '@/components/charts/photos-by-body-part-chart';
import { PatientsGrowthChart } from '@/components/charts/patients-growth-chart';
import type { PhotoWithPatient } from '@/lib/hooks/use-all-photos';

export default function HomePage() {
  const router = useRouter();
  const { clinician, session, loading } = useAuth();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<PhotoWithPatient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activePhoto, setActivePhoto] = useState<PhotoWithPatient | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Auth gate: while the session is resolving, hold; once resolved, require a
  // session (redirect to /login). The dashboard layout enforces the same, but
  // the home route sits outside (dashboard) so it must self-gate.
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
  }, [loading, session, router]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [all, allPhotos] = await Promise.all([
          patientService.getAllPatients({ includeArchived: false }),
          photoService.getAllPhotos({ limit: 200 }),
        ]);
        if (!mounted) return;

        const nameById = new Map(all.map((p) => [p.id, p.name]));
        const withNames = allPhotos.map((photo) => ({
          ...photo,
          patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
        }));

        setPatients(all);
        setRecentPhotos(withNames);
      } catch {
        if (mounted) {
          setPatients([]);
          setRecentPhotos([]);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const greeting = useMemo(() => {
    const name = clinician?.displayName?.split(' ')[0];
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  }, [clinician]);

  const isEmpty = !isLoading && patients.length === 0;

  // When a calendar day is selected, the "latest photos" bento filters to it.
  const visiblePhotos = useMemo(() => {
    if (!selectedDate) return recentPhotos.slice(0, 8);
    return recentPhotos.filter((p) => isSameDay(p.capturedAt, selectedDate)).slice(0, 8);
  }, [recentPhotos, selectedDate]);

  function handlePhotoClick(photo: PhotoWithPatient) {
    setActivePhoto(photo);
    setDialogOpen(true);
  }

  function handleRefresh() {
    setIsLoading(true);
    Promise.all([
      patientService.getAllPatients({ includeArchived: false }),
      photoService.getAllPhotos({ limit: 200 }),
    ])
      .then(([all, allPhotos]) => {
        const nameById = new Map(all.map((p) => [p.id, p.name]));
        setPatients(all);
        setRecentPhotos(
          allPhotos.map((photo) => ({
            ...photo,
            patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
          })),
        );
      })
      .finally(() => setIsLoading(false));
  }

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-2 h-4 w-80" />
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <PageHeader title="Welcome to Camog" description="Capture and track clinical photos with structured metadata." />
        <EmptyState
          icon={Camera}
          title="No patients yet"
          description="Capture your first photo to create a patient record and start a timeline."
          action={
            <Button asChild>
              <Link href="/capture">
                <Camera className="size-4" />
                Capture first photo
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const topPatients = patients.slice(0, 6);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title={greeting}
        description="Review activity or capture a new photo."
        actions={
          <Button asChild>
            <Link href="/capture">
              <Camera className="size-4" />
              Capture photo
            </Link>
          </Button>
        }
      />

      {/* KPIs */}
      <StatsOverview patients={patients} photos={recentPhotos} />

      {/* Charts */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <PhotosOverTimeChart photos={recentPhotos} />
        <PhotosByBodyPartChart photos={recentPhotos} />
        <PatientsGrowthChart patients={patients} />
      </div>

      {/* Activity calendar + recent patients side by side */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <ActivityCalendar
          photos={recentPhotos}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />

        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="size-4" />
              Recent patients
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/patients">
                All patients
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {topPatients.map((p) => (
              <PatientBentoTile
                key={p.id}
                patient={p}
                onClick={() => router.push(`/patients/view?id=${p.id}`)}
              />
            ))}
          </div>
        </section>
      </div>

      {/* Latest / selected-day photos */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Images className="size-4" />
            {selectedDate ? `Photos on ${selectedDate.toLocaleDateString()}` : 'Latest photos'}
          </h2>
          {selectedDate && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDate(null)}>
              Clear date
            </Button>
          )}
        </div>

        {visiblePhotos.length === 0 ? (
          <EmptyState
            icon={Images}
            title={selectedDate ? 'No photos on that day' : 'No photos yet'}
            description={
              selectedDate
                ? 'Pick another day on the calendar, or clear the filter.'
                : 'Once you capture photos, the most recent ones will appear here.'
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visiblePhotos.map((photo) => (
              <RecentPhotoTile
                key={photo.id}
                photo={photo}
                onClick={() => handlePhotoClick(photo)}
              />
            ))}
          </div>
        )}
      </section>

      <PhotoDetailDialog
        photo={activePhoto}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onChanged={handleRefresh}
      />
    </div>
  );
}

function PatientBentoTile({
  patient,
  onClick,
}: {
  patient: Patient;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
    >
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">{patient.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {patient.lastPhotoAt
            ? `Last photo ${formatRelativeTime(patient.lastPhotoAt)}`
            : 'No photos yet'}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Badge variant="secondary">
          {patient.photoCount} {patient.photoCount === 1 ? 'photo' : 'photos'}
        </Badge>
        <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          View →
        </span>
      </div>
    </button>
  );
}

function RecentPhotoTile({
  photo,
  onClick,
}: {
  photo: PhotoWithPatient;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    photoService
      .exportPhotoAsDataUrl(photo.id, true)
      .then((u) => mounted && setUrl(u))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [photo.id]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Photo of ${BodyPartLabels[photo.bodyPart as BodyPart]} for ${photo.patientName}, ${formatRelativeTime(photo.capturedAt)}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
    >
      <div className="relative aspect-square w-full bg-muted">
        {url ? (
          <img
            src={url}
            alt={`Photo of ${BodyPartLabels[photo.bodyPart as BodyPart]}`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-muted" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{photo.patientName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {BodyPartLabels[photo.bodyPart as BodyPart]}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(photo.capturedAt)}
        </span>
      </div>
    </button>
  );
}
