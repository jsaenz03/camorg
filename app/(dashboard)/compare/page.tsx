'use client';

/**
 * Compare page
 *
 * Cross-patient lesion comparison. Pick a reference patient and a
 * comparison patient (the same patient twice gives the before/after
 * workflow), then choose which captures fill each pane — part and
 * lesion-series filters live inside the shared compare view. Static-export
 * friendly: /compare?patient=<id>&part=<bodyPart> preselects the pickers.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Columns2, Users } from 'lucide-react';
import { BODY_PARTS, type BodyPart } from '@/types/body-part';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { PhotoCompareView } from '@/components/photo/photo-compare-view';
import { usePatients } from '@/lib/hooks/use-patients';
import { usePhotos } from '@/lib/hooks/use-photos';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function CompareView() {
  const searchParams = useSearchParams();
  const { patients, isLoading: patientsLoading } = usePatients({ includeArchived: true });

  const [patientAId, setPatientAId] = useState<string | null>(null);
  const [patientBId, setPatientBId] = useState<string | null>(null);
  // Deep-link seed for the view's part filter (?part=<bodyPart>).
  const [initialPart] = useState<BodyPart | 'all'>(() => {
    const requested = searchParams.get('part');
    return requested && (BODY_PARTS as string[]).includes(requested)
      ? (requested as BodyPart)
      : 'all';
  });

  // Reference patient: keep a valid deep-linked pick, otherwise the first
  // patient that actually has photos.
  useEffect(() => {
    if (patientsLoading || patients.length === 0) return;
    setPatientAId((cur) => {
      if (cur && patients.some((p) => p.id === cur)) return cur;
      const withPhotos = patients.filter((p) => p.photoCount > 0);
      return withPhotos[0]?.id ?? patients[0].id;
    });
  }, [patientsLoading, patients]);

  // Comparison patient: the next patient with photos, so the page opens on
  // a genuine cross-patient pair; with a single patient it degrades to the
  // before/after workflow.
  useEffect(() => {
    if (patientsLoading || patients.length === 0) return;
    setPatientBId((cur) => {
      if (cur && patients.some((p) => p.id === cur)) return cur;
      const others = patients.filter((p) => p.photoCount > 0 && p.id !== patientAId);
      return (
        others[0]?.id ?? patients.find((p) => p.id !== patientAId)?.id ?? patientAId ?? null
      );
    });
  }, [patientsLoading, patients, patientAId]);

  const patientA = patients.find((p) => p.id === patientAId) ?? null;
  const patientB = patients.find((p) => p.id === patientBId) ?? null;

  // The shared view owns the part/series filters (they prune its own pools),
  // so the page fetches each patient's full photo set.
  const left = usePhotos({ patientId: patientAId ?? undefined });
  const right = usePhotos({ patientId: patientBId ?? undefined });

  const patientPicker = (
    label: string,
    value: string | null,
    onChange: (id: string) => void,
    which: string,
  ) => (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger aria-label={which}>
          <SelectValue placeholder="Choose a patient" />
        </SelectTrigger>
        <SelectContent>
          {patients.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Compare"
        description="Put lesions side by side across patients — or the same patient over time."
      />

      {patientsLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <Skeleton className="h-[60dvh] rounded-lg" />
        </div>
      ) : patients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No patients yet"
          description="Register a patient and capture photos to start comparing lesions."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {patientPicker('Reference patient', patientAId, setPatientAId, 'Reference patient')}
            {patientPicker('Comparison patient', patientBId, setPatientBId, 'Comparison patient')}
          </div>

          <div className="flex h-[64dvh] min-h-[420px] flex-col">
            {left.isLoading || right.isLoading ? (
              <div className="grid h-full grid-cols-2 gap-2 rounded-lg border">
                <Skeleton className="h-full w-full rounded-none" />
                <Skeleton className="h-full w-full rounded-none" />
              </div>
            ) : (
              <PhotoCompareView
                leftPool={left.photos}
                rightPool={right.photos}
                leftLabel={`Reference — ${patientA?.name ?? ''}`}
                rightLabel={`Comparison — ${patientB?.name ?? ''}`}
                initialPart={initialPart}
              />
            )}
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Columns2 className="size-3.5" />
            Panes are anchored: drag or scroll either photo to move both together. Toggle Anchor
            off to frame each photo on its own.
          </p>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-80" />
          <Skeleton className="mt-8 h-[60dvh] rounded-lg" />
        </div>
      }
    >
      <CompareView />
    </Suspense>
  );
}
