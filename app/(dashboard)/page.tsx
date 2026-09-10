'use client';

/**
 * Home dashboard.
 *
 * The page loads the data (patients, photo summaries, recent photos) and
 * renders its sections as widgets through DashboardCanvas, so each user can
 * reorder (drag), remove and re-add them, or restore the default layout —
 * the order persists in clinician preferences (dashboardWidgets).
 * Sits inside the dashboard layout, so the sidebar and session gate come for
 * free; useAuth only supplies the clinician name for the greeting.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Check, Images, Pencil, Users, ArrowRight, Smartphone } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { bodyPartDisplayLabel } from '@/types/body-part';
import { patientService } from '@/lib/services/patient-service';
import { photoService, type PhotoSummary } from '@/lib/services/photo-service';
import { authService } from '@/lib/services/auth-service';
import {
  DEFAULT_DASHBOARD_WIDGETS,
  resolveDashboardWidgets,
  type DashboardWidgetId,
} from '@/lib/dashboard-widgets';
import { BodyMapBadge } from '@/components/patient/body-map-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { useCapture, reviewFollowUpCapture } from '@/components/capture/capture-provider';
import { useCompanion } from '@/components/companion/companion-provider';
import { PhoneLinkDialog } from '@/components/companion/phone-link-dialog';
import { formatRelativeTime } from '@/lib/utils/date-formatting';
import { startOfDay, endOfDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PhotoDetailDialog } from '@/components/photo/photo-detail-dialog';
import { StatsOverview } from '@/components/dashboard/stats-overview';
import { ActivityCalendar } from '@/components/dashboard/activity-calendar';
import { NeedsAttention } from '@/components/dashboard/needs-attention';
import { RecentActions } from '@/components/dashboard/recent-actions';
import { DashboardCanvas } from '@/components/dashboard/dashboard-canvas';
import { PhotosOverTimeChart } from '@/components/charts/photos-over-time-chart';
import { PhotosByBodyPartChart } from '@/components/charts/photos-by-body-part-chart';
import { PatientsGrowthChart } from '@/components/charts/patients-growth-chart';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { PhotoWithPatient } from '@/lib/hooks/use-all-photos';

export default function HomePage() {
  const router = useRouter();
  const { clinician, refresh } = useAuth();
  const { openCapture } = useCapture();
  const companion = useCompanion();
  const {
    items: attentionItems,
    isLoading: isLoadingAttention,
  } = useNotifications();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<PhotoWithPatient[]>([]);
  // Lightweight rows for KPIs/charts/calendar — unlimited, unlike the full
  // records above, so aggregates stay correct past any display limit.
  const [summaries, setSummaries] = useState<PhotoSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activePhoto, setActivePhoto] = useState<PhotoWithPatient | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  // Day-filtered bento photos, queried directly so a day outside the newest
  // 200 still shows its photos.
  const [dayPhotos, setDayPhotos] = useState<PhotoWithPatient[]>([]);

  // Honour the "Show deleted photos" preference alongside the clinician name.
  const showDeleted = clinician?.preferences.showDeletedPhotos ?? false;

  useEffect(() => {
    let mounted = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [all, allSummaries, allPhotos] = await Promise.all([
          patientService.getAllPatients({ includeArchived: false }),
          photoService.getAllPhotoSummaries({ includeDeleted: showDeleted }),
          photoService.getAllPhotos({ limit: 200, includeDeleted: showDeleted }),
        ]);
        if (!mounted) return;

        const nameById = new Map(all.map((p) => [p.id, p.name]));
        const withNames = allPhotos.map((photo) => ({
          ...photo,
          patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
        }));

        setPatients(all);
        setSummaries(allSummaries);
        setRecentPhotos(withNames);
      } catch (err) {
        // A load failure is NOT an empty clinic — surface it distinctly so
        // "my patients are gone" can't be mistaken for data loss.
        if (mounted) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setPatients([]);
          setSummaries([]);
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
  }, [showDeleted]);

  // Calendar day selection: fetch that day's photos (bento shows up to 8).
  useEffect(() => {
    if (!selectedDate) {
      setDayPhotos([]);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const rows = await photoService.getAllPhotos({
          from: startOfDay(selectedDate),
          to: endOfDay(selectedDate),
          includeDeleted: showDeleted,
          limit: 8,
        });
        if (!mounted) return;
        const nameById = new Map(patients.map((p) => [p.id, p.name]));
        setDayPhotos(
          rows.map((photo) => ({
            ...photo,
            patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
          })),
        );
      } catch {
        if (mounted) setDayPhotos([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedDate, showDeleted, patients]);

  const greeting = useMemo(() => {
    const name = clinician?.displayName?.split(' ')[0];
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  }, [clinician]);

  const isEmpty = !isLoading && !loadError && patients.length === 0;

  // ----- customisable widget layout -----
  // Order state is local for live dragging; lastSavedRef fences the sync
  // effect so a refresh() round-trip can't clobber an in-flight reorder.
  const storedWidgets = clinician?.preferences.dashboardWidgets ?? null;
  const [order, setOrder] = useState<DashboardWidgetId[]>(() =>
    resolveDashboardWidgets(storedWidgets),
  );
  const lastSavedRef = useRef(JSON.stringify(resolveDashboardWidgets(storedWidgets)));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const resolved = resolveDashboardWidgets(storedWidgets);
    const key = JSON.stringify(resolved);
    if (key !== lastSavedRef.current) {
      lastSavedRef.current = key;
      setOrder(resolved);
    }
  }, [storedWidgets]);

  /** Persist a layout change (null = follow the default layout again). */
  async function saveWidgets(next: DashboardWidgetId[] | null) {
    const resolved = next === null ? [...DEFAULT_DASHBOARD_WIDGETS] : next;
    setOrder(resolved);
    lastSavedRef.current = JSON.stringify(resolved);
    try {
      await authService.updatePreferences({ dashboardWidgets: next });
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the dashboard layout',
      );
    }
  }

  // When a calendar day is selected, the "latest photos" bento filters to it.
  const visiblePhotos = useMemo(() => {
    if (!selectedDate) return recentPhotos.slice(0, 8);
    return dayPhotos;
  }, [recentPhotos, selectedDate, dayPhotos]);

  function handlePhotoClick(photo: PhotoWithPatient) {
    setActivePhoto(photo);
    setDialogOpen(true);
  }

  // Background refresh: keeps the page (and any open photo dialog) on
  // screen while the data reloads — flipping isLoading here used to flash
  // the skeleton over the dialog on Mark reviewed / Save.
  function handleRefresh() {
    Promise.all([
      patientService.getAllPatients({ includeArchived: false }),
      photoService.getAllPhotoSummaries({ includeDeleted: showDeleted }),
      photoService.getAllPhotos({ limit: 200, includeDeleted: showDeleted }),
    ])
      .then(([all, allSummaries, allPhotos]) => {
        const nameById = new Map(all.map((p) => [p.id, p.name]));
        setPatients(all);
        setSummaries(allSummaries);
        setRecentPhotos(
          allPhotos.map((photo) => ({
            ...photo,
            patientName: nameById.get(photo.patientId) ?? 'Unknown patient',
          })),
        );
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  }

  /** Opens capture for a review follow-up — prefilled with the original's
      location and linked to it via a shared lesion series on save. */
  function handleSnapReviewPhoto() {
    if (!activePhoto) return;
    openCapture(
      reviewFollowUpCapture(activePhoto, {
        patientName: activePhoto.patientName,
        onSaved: handleRefresh,
      }),
    );
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

  if (loadError) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <PageHeader title={greeting} description="Review activity or capture a new photo." />
        <EmptyState
          icon={Images}
          title="Couldn’t load the dashboard"
          description={`${loadError} — your data hasn’t changed; this is a read failure. Check the app/storage connection and try again.`}
          action={
            <Button variant="outline" onClick={handleRefresh}>
              Try again
            </Button>
          }
        />
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
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => openCapture()}>
                <Camera className="size-4" />
                Capture first photo
              </Button>
              {/* Pairing stays reachable before the first photo exists: the
                  header's Phone link button only renders once the dashboard
                  widgets do, and its dialog is where the Tailscale URLs live. */}
              <PhoneLinkDialog>
                <Button variant="outline">
                  <Smartphone className="size-4" />
                  Phone link
                </Button>
              </PhoneLinkDialog>
            </div>
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
          <div className="flex items-center gap-2">
            <Button
              variant={editing ? 'default' : 'outline'}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? (
                <>
                  <Check className="size-4" />
                  Done
                </>
              ) : (
                <>
                  <Pencil className="size-4" />
                  Customise
                </>
              )}
            </Button>
            {/* Phone link + capture are session controls, not routes — they
                live here on the dashboard instead of the sidebar. The dot is
                a live-session indicator (privacy state, not decoration). */}
            <PhoneLinkDialog>
              <Button variant="outline">
                <span className="relative">
                  <Smartphone className="size-4" />
                  {companion.active && (
                    <span
                      className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary"
                      aria-label="Phone link session active"
                    />
                  )}
                </span>
                Phone link
              </Button>
            </PhoneLinkDialog>
            <Button onClick={() => openCapture()}>
              <Camera className="size-4" />
              Capture photo
            </Button>
          </div>
        }
      />

      <DashboardCanvas
        value={order}
        editing={editing}
        onChange={setOrder}
        onCommit={(next) => void saveWidgets(next)}
        onRestoreDefault={() => void saveWidgets(null)}
        renderWidget={renderWidget}
      />

      <PhotoDetailDialog
        photo={activePhoto}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onChanged={handleRefresh}
        onSnapReviewPhoto={handleSnapReviewPhoto}
      />
    </div>
  );

  function renderWidget(id: DashboardWidgetId): ReactNode {
    switch (id) {
      case 'stats':
        return <StatsOverview patients={patients} photos={summaries} />;
      case 'attention':
        return (
          <NeedsAttention items={attentionItems} isLoading={isLoadingAttention} />
        );
      case 'recent-actions':
        return <RecentActions />;
      case 'chart-photos-over-time':
        return <PhotosOverTimeChart photos={summaries} />;
      case 'chart-body-part':
        return <PhotosByBodyPartChart photos={summaries} />;
      case 'chart-patient-growth':
        return <PatientsGrowthChart patients={patients} />;
      case 'calendar':
        return (
          <ActivityCalendar
            photos={summaries}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        );
      case 'recent-patients':
        return (
          <div>
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
          </div>
        );
      case 'latest-photos':
        return (
          <div>
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
          </div>
        );
    }
  }
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
        <span className="flex items-center gap-0.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          View
          <ArrowRight className="size-3" />
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
      aria-label={`Photo of ${bodyPartDisplayLabel(photo.bodyPart, photo.laterality)} for ${photo.patientName}, ${formatRelativeTime(photo.capturedAt)}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
    >
      <div className="relative aspect-square w-full bg-muted">
        {url ? (
          <img
            src={url}
            alt={`Photo of ${bodyPartDisplayLabel(photo.bodyPart, photo.laterality)}`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-muted" />
        )}
        {/* Body-map indicator: same white-chip convention as the timeline
            tiles, so the overlay reads on every photo surface. */}
        <span
          className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-white p-1 shadow-sm ring-1 ring-black/10"
          title={bodyPartDisplayLabel(photo.bodyPart, photo.laterality)}
        >
          <BodyMapBadge
            bodyPart={photo.bodyPart}
            laterality={photo.laterality}
            className="block h-9 w-[22.5px]"
          />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{photo.patientName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {bodyPartDisplayLabel(photo.bodyPart, photo.laterality)}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(photo.capturedAt)}
        </span>
      </div>
    </button>
  );
}
