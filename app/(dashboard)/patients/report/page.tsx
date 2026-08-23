'use client';

/**
 * Patient Case Report
 *
 * Print-ready summary of a patient's photo history: header with identity +
 * consent status, then every active photo in capture order with its date,
 * body part, subpart and clinical notes. The browser print dialog
 * ("Save as PDF") does the PDF generation — no extra dependency.
 *
 * Static-export friendly: reads patient id from ?id= query param.
 */

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { consentStatus, ConsentScopeLabels } from '@/types/patient';
import { BodyPartLabels } from '@/types/body-part';
import { patientService } from '@/lib/services/patient-service';
import { photoService } from '@/lib/services/photo-service';
import { auditService } from '@/lib/services/audit-service';
import { formatDateOfBirth } from '@/lib/utils/date-formatting';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface ReportPhoto {
  id: string;
  url: string;
  capturedAt: Date;
  bodyPart: string;
  subpart: string | null;
  clinicalNotes: string | null;
}

function ReportView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const patientId = searchParams.get('id') as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
        if (cancelled) return;
        setPatient(p);

        // Full-size images, oldest first (the report reads chronologically).
        const ordered = [...records].sort(
          (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
        );
        const loaded: ReportPhoto[] = [];
        const bad: string[] = [];
        for (const r of ordered) {
          try {
            const url = await photoService.exportPhotoAsDataUrl(r.id);
            loaded.push({
              id: r.id,
              url,
              capturedAt: r.capturedAt,
              bodyPart: BodyPartLabels[r.bodyPart] ?? r.bodyPart,
              subpart: r.subpart,
              clinicalNotes: r.clinicalNotes,
            });
          } catch {
            bad.push(r.id);
          }
        }
        if (cancelled) return;
        setPhotos(loaded);
        setFailed(bad);
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

  function handlePrint() {
    void auditService.record('photo.export', {
      entityType: 'patient',
      entityId: patientId,
      patientId,
      detail: `case report printed (${photos.length} photos)`,
    });
    window.print();
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

  const consentText =
    consent === 'valid'
      ? `${ConsentScopeLabels[patient.consentScope ?? 'care']}${
          patient.consentExpiresAt
            ? ` (expires ${format(patient.consentExpiresAt, 'dd/MM/yyyy')})`
            : ''
        }`
      : consent === 'expired'
        ? 'EXPIRED'
        : 'None on record';

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <div className="print-hidden mb-6 flex items-center gap-2">
        <Button variant="ghost" onClick={() => router.push(`/patients/view?id=${patient.id}`)} className="-ml-2">
          <ArrowLeft className="size-4" />
          Back to timeline
        </Button>
        <Button className="ml-auto" onClick={handlePrint} disabled={photos.length === 0}>
          <Printer className="size-4" />
          Print / Save as PDF
        </Button>
      </div>

      <div className="print-report space-y-8">
        <header className="border-b pb-4">
          <h1 className="text-2xl font-semibold">Patient case report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated {format(new Date(), 'dd/MM/yyyy HH:mm')} · Camog
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Patient</dt>
              <dd className="font-medium">{patient.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Date of birth</dt>
              <dd className="font-medium">
                {patient.dateOfBirth ? formatDateOfBirth(patient.dateOfBirth) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Photos</dt>
              <dd className="font-medium">{photos.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="font-medium">{patient.ownerName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Consent</dt>
              <dd className={consent === 'valid' ? 'font-medium' : 'font-medium text-destructive'}>
                {consentText}
              </dd>
            </div>
          </dl>
        </header>

        {failed.length > 0 && (
          <p className="print-hidden text-sm text-destructive">
            {failed.length} photo{failed.length === 1 ? '' : 's'} could not be loaded and
            {' '}were left out of this report.
          </p>
        )}

        {photos.length === 0 ? (
          <p className="text-muted-foreground">No photos on record for this patient.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {photos.map((photo, i) => (
              <figure key={photo.id} className="print-break space-y-2">
                <div className="overflow-hidden rounded-lg border bg-black">
                  <img
                    src={photo.url}
                    alt={`Photo ${i + 1}: ${photo.bodyPart}, taken ${format(photo.capturedAt, 'd MMM yyyy')}`}
                    className="h-auto w-full object-contain"
                  />
                </div>
                <figcaption className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {format(photo.capturedAt, 'dd/MM/yyyy')}
                  </span>{' '}
                  · {photo.bodyPart}
                  {photo.subpart ? ` · ${photo.subpart}` : ''}
                  {photo.clinicalNotes ? (
                    <>
                      <br />
                      {photo.clinicalNotes}
                    </>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
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
