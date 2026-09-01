'use client';

/**
 * Patient Case Report
 *
 * Preview of the printable case report plus a one-click "Save PDF" flow: the
 * native save dialog picks the location, then the Rust side (report.rs)
 * renders a styled PDF locally with krilla and writes it to disk. Nothing
 * leaves the device; the doctor sends the file to the patient themselves.
 *
 * Static-export friendly: reads patient id from ?id= query param.
 */

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { format } from 'date-fns';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, FileDown, Loader2, Printer } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { consentStatus, ConsentScopeLabels } from '@/types/patient';
import { BodyPartLabels, bodyPartSurfaceLabel, type BodyPart, type Laterality, type Pinpoint } from '@/types/body-part';
import { BodyMapBadge } from '@/components/patient/body-map-badge';
import { PinMarker } from '@/components/patient/body-map-picker';
import { PartDetailDiagram, hasPartDetail } from '@/components/patient/part-detail-diagram';
import { patientService } from '@/lib/services/patient-service';
import { photoService } from '@/lib/services/photo-service';
import { auditService } from '@/lib/services/audit-service';
import { accessService } from '@/lib/services/access-service';
import { formatDateOfBirth } from '@/lib/utils/date-formatting';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface ReportPhoto {
  id: string;
  url: string;
  path: string;
  capturedAt: Date;
  bodyPart: string;
  /** Raw enum key so the body-map diagram can highlight the right region. */
  bodyPartKey: BodyPart;
  laterality: Laterality | null;
  /** Saved pinpoint X on either diagram; the space says which one it lives on. */
  pin: Pinpoint | null;
  subpart: string | null;
  clinicalNotes: string | null;
}

/** "Left hand" — side prefixed onto the display label for paired regions. */
function siteLabel(photo: Pick<ReportPhoto, 'bodyPart' | 'laterality'>): string {
  return photo.laterality
    ? `${photo.laterality === 'left' ? 'Left' : 'Right'} ${photo.bodyPart}`
    : photo.bodyPart;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sanitiseFileToken(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

function ReportView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [preparedBy, setPreparedBy] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    if (!patientId) {
      toast.error('No patient selected');
      router.push('/patients');
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const p = await patientService.getPatientById(patientId);
        if (!p) {
          toast.error('Patient not found');
          router.push('/patients');
          return;
        }
        const records = await photoService.getPhotosByPatient(patientId, {
          includeDeleted: false,
        });
        const clinician = await accessService
          .getCurrentClinician()
          .then((c) => c.displayName)
          .catch(() => null);
        if (cancelled) return;
        setPreparedBy(clinician ?? p.ownerName ?? 'Clinician');
        if (cancelled) return;

        // Full-size images, oldest first (the report reads chronologically).
        // ponytail: capped at 50 — every image loads as a full-size base64
        // data URL, so a large timeline would freeze the report page.
        // Upgrade path: paginate the report or print from scaled-down copies.
        const MAX_REPORT_PHOTOS = 50;
        const ordered = [...records]
          .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
          .slice(0, MAX_REPORT_PHOTOS)
          .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
        const paths = await photoService.getActivePhotoFilePaths(patientId);
        const loaded: ReportPhoto[] = [];
        const bad: string[] = [];
        for (const r of ordered) {
          const path = paths.get(r.id);
          if (!path) {
            bad.push(r.id);
            continue;
          }
          try {
            const url = await photoService.exportPhotoAsDataUrl(r.id);
            loaded.push({
              id: r.id,
              url,
              path,
              capturedAt: r.capturedAt,
              bodyPart: BodyPartLabels[r.bodyPart] ?? r.bodyPart,
              bodyPartKey: r.bodyPart,
              laterality: r.laterality,
              pin:
                r.pinX != null && r.pinY != null && r.pinSpace != null
                  ? { x: r.pinX, y: r.pinY, space: r.pinSpace, view: r.pinView ?? 'front' }
                  : null,
              subpart: r.subpart,
              clinicalNotes: r.clinicalNotes,
            });
          } catch {
            bad.push(r.id);
          }
        }
        if (cancelled) return;
        setPatient(p);
        setPhotos(loaded);
        setFailed(bad);
        if (records.length > ordered.length) {
          toast.info(
            `Report shows the ${ordered.length} most recent of ${records.length} photos.`
          );
        }
      } catch {
        if (!cancelled) toast.error('Failed to load report');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [patientId, router]);

  const consent = useMemo(() => (patient ? consentStatus(patient) : 'none'), [patient]);

  const consentText =
    consent === 'valid'
      ? `${ConsentScopeLabels[patient?.consentScope ?? 'care']}${
          patient?.consentExpiresAt
            ? ` (expires ${format(patient.consentExpiresAt, 'dd/MM/yyyy')})`
            : ''
        }`
      : consent === 'expired'
        ? 'EXPIRED'
        : 'None on record';

  const photoCountLabel = useMemo(() => {
    if (!patient) return '';
    return photos.length === patient.photoCount
      ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`
      : `${photos.length} of ${patient.photoCount} photos`;
  }, [patient, photos]);

  const timelineLabel = useMemo(() => {
    if (photos.length === 0) return null;
    const first = photos[0].capturedAt;
    const last = photos[photos.length - 1].capturedAt;
    return `${format(first, 'dd/MM/yyyy')} to ${format(last, 'dd/MM/yyyy')}`;
  }, [photos]);

  function handlePrint() {
    // WKWebView's window.print() is a silent no-op; go through Tauri's
    // native print dialog instead.
    void auditService.record('photo.export', {
      entityType: 'patient',
      entityId: patientId,
      patientId,
      detail: `case report printed (${photos.length} photos)`,
    });
    invoke('print_report').catch((e: unknown) =>
      toast.error(errorText(e), { duration: 8000 })
    );
  }

  async function handleSavePdf() {
    if (!patient || photos.length === 0 || isGenerating) return;
    const defaultName = `Camog case report - ${sanitiseFileToken(patient.name)} - ${format(new Date(), 'yyyy-MM-dd')}.pdf`;

    const target = await save({
      title: 'Save case report',
      defaultPath: defaultName,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (!target) return; // cancelled

    setIsGenerating(true);
    try {
      const outcome = await invoke<{ pageCount: number }>('generate_case_report', {
        request: {
          savePath: target,
          patientName: patient.name,
          dateOfBirth: patient.dateOfBirth ? formatDateOfBirth(patient.dateOfBirth) : null,
          treatingClinician: patient.ownerName ?? null,
          preparedBy,
          preparedAt: format(new Date(), 'dd/MM/yyyy, h:mm a'),
          consentLabel: consentText,
          consentValid: consent === 'valid',
          photoCountLabel,
          timelineLabel,
          photos: photos.map((p) => ({
            path: p.path,
            capturedLabel: format(p.capturedAt, 'dd/MM/yyyy'),
            bodyPart: siteLabel(p),
            bodyPartKey: p.bodyPartKey,
            laterality: p.laterality,
            pinX: p.pin?.x ?? null,
            pinY: p.pin?.y ?? null,
            pinSpace: p.pin?.space ?? null,
            pinView: p.pin?.view ?? null,
            subpart: p.subpart,
            clinicalNotes: p.clinicalNotes,
          })),
        },
      });
      void auditService.record('photo.export', {
        entityType: 'patient',
        entityId: patientId,
        patientId,
        detail: `case report PDF saved (${photos.length} photos, ${outcome.pageCount} pages)`,
      });
      toast.success(`Report saved (${outcome.pageCount} ${outcome.pageCount === 1 ? 'page' : 'pages'})`, {
        description: target,
        action: {
          label: 'Show in Finder',
          onClick: () => {
            void invoke('reveal_saved_report', { path: target }).catch((e: unknown) =>
              toast.error(String(e))
            );
          },
        },
      });
    } catch (error) {
      toast.error(errorText(error), { duration: 8000 });
    } finally {
      setIsGenerating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-2 h-4 w-80" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  if (!patient) return null;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <div className="print-hidden mb-6 flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => router.push(`/patients/view?id=${patient.id}`)}
          className="-ml-2"
        >
          <ArrowLeft className="size-4" />
          Back to timeline
        </Button>
        <p className="ml-2 hidden max-w-sm text-xs leading-relaxed text-muted-foreground lg:block">
          The PDF is created on this device only. Send it to your patient from your email or
          messaging app.
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={handlePrint} disabled={photos.length === 0}>
            <Printer className="size-4" />
            Print
          </Button>
          <Button
            onClick={() => void handleSavePdf()}
            disabled={photos.length === 0 || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            Save PDF
          </Button>
        </div>
      </div>

      {/* Paper preview: the document artifact stays light-themed even in dark
          mode; only the surrounding chrome follows the app theme. */}
      <article className="print-report mx-auto w-full max-w-[820px] rounded-lg border bg-white px-8 py-10 text-zinc-900 shadow-sm md:px-12">
        <header>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            Camog · Clinical photo documentation
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Patient case report</h1>
            <div className="text-right text-xs leading-relaxed text-zinc-600">
              <p>Prepared by {preparedBy ?? 'Clinician'}</p>
              <p>{format(new Date(), 'dd/MM/yyyy, h:mm a')}</p>
            </div>
          </div>
          <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Patient
              </dt>
              <dd className="mt-1 text-sm font-medium">{patient.name}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Date of birth
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {patient.dateOfBirth ? formatDateOfBirth(patient.dateOfBirth) : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Photos
              </dt>
              <dd className="mt-1 text-sm font-medium">{photoCountLabel}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Treating clinician
              </dt>
              <dd className="mt-1 text-sm font-medium">{patient.ownerName ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Photo timeline
              </dt>
              <dd className="mt-1 text-sm font-medium">{timelineLabel ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                Photo consent
              </dt>
              <dd
                className={`mt-1 text-sm font-medium ${
                  consent === 'valid' ? '' : 'text-red-700'
                }`}
              >
                {consentText}
              </dd>
            </div>
          </dl>
          <div className="mt-8 border-t-2 border-[#007B82]" />
        </header>

        {photos.length === 0 ? (
          <p className="mt-8 text-sm text-zinc-500">No photos on record for this patient.</p>
        ) : (
          <div className="mt-8 space-y-8">
            {photos.map((photo, i) => (
              <figure key={photo.id} className="print-break flex flex-col gap-4 sm:flex-row">
                <img
                  src={photo.url}
                  alt={`Photo ${i + 1}: ${photo.bodyPart}, taken ${format(photo.capturedAt, 'd MMM yyyy')}`}
                  className="w-full shrink-0 rounded-sm border border-zinc-200 bg-white object-contain sm:w-60"
                />
                <figcaption className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{format(photo.capturedAt, 'dd/MM/yyyy')}</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                    Photo {i + 1} of {photos.length}
                  </p>
                  <div className="mt-2 flex items-start gap-3">
                    <span
                      className="shrink-0 rounded-sm border border-zinc-200 bg-white p-1"
                      title={`Body map — ${siteLabel(photo)}`}
                      aria-hidden="true"
                    >
                      <BodyMapBadge
                        bodyPart={photo.bodyPartKey}
                        laterality={photo.laterality}
                        pin={photo.pin?.space === 'body' ? photo.pin : null}
                        className="block h-24 w-[60px]"
                      />
                    </span>
                    {photo.pin?.space === 'part' && hasPartDetail(photo.bodyPartKey) && (
                      <span
                        className="shrink-0 rounded-sm border border-zinc-200 bg-white p-1"
                        title={`Exact spot — ${bodyPartSurfaceLabel(photo.bodyPartKey, photo.laterality, photo.pin.view)}`}
                        aria-hidden="true"
                      >
                        <svg viewBox="0 0 200 320" className="block h-24 w-[60px]" focusable="false">
                          <PartDetailDiagram
                            part={photo.bodyPartKey}
                            side={photo.laterality}
                            view={photo.pin.view}
                            tone="on-light"
                          />
                          <PinMarker pin={photo.pin} />
                        </svg>
                      </span>
                    )}
                    <p className="text-sm font-medium">
                      {siteLabel(photo)}
                      {photo.subpart ? (
                        <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                          {photo.subpart}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {photo.clinicalNotes ? (
                    <>
                      <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                        Notes
                      </p>
                      <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">
                        {photo.clinicalNotes}
                      </p>
                    </>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {photos.length > 0 && (
          <footer className="mt-10 border-t border-zinc-200 pt-4">
            <p className="text-xs leading-relaxed text-zinc-500">
              This report was generated locally with Camog on{' '}
              {format(new Date(), 'dd/MM/yyyy, h:mm a')}. All photos and clinical notes remain
              stored on the treating clinician&apos;s device; Camog does not transmit patient
              data.
            </p>
          </footer>
        )}
      </article>

      {failed.length > 0 && (
        <p className="print-hidden mt-4 text-sm text-destructive">
          {failed.length} photo{failed.length === 1 ? '' : 's'} could not be loaded and{' '}
          {failed.length === 1 ? 'was' : 'were'} left out of this report.
        </p>
      )}
    </div>
  );
}

export default function PatientReportPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading report…
          </div>
        </div>
      }
    >
      <ReportView />
    </Suspense>
  );
}
