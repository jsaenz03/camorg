/**
 * Patients List Page
 *
 * Searchable grid of patients. Entry point for User Story 2.
 * Also loads the per-photo review schedule so each patient row/card can show
 * how many of its photos are due for review (indicator only — a failed fetch
 * just hides the counters).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { PatientList } from '@/components/patient/patient-list';
import { AddPatientDialog } from '@/components/patient/add-patient-dialog';
import { PhotoUpload } from '@/components/photo/photo-upload';
import { PageHeader } from '@/components/page-header';
import { usePatients } from '@/lib/hooks/use-patients';
import { useBranding } from '@/components/branding-boot';
import { photoService } from '@/lib/services/photo-service';
import { photoReviewStatus } from '@/lib/utils/photo-review';
import { ATTENTION_CHANGED_EVENT } from '@/lib/services/attention-events';
import type { Patient } from '@/types/patient';
import type { DueReviewCounts } from '@/components/patient/photo-review-due-badge';
import { Button } from '@/components/ui/button';

export default function PatientsPage() {
  const router = useRouter();
  const { patients, isLoading, error, search, refresh } = usePatients({
    includeArchived: false,
  });
  const { reviewWarningDays } = useBranding();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [dueByPatient, setDueByPatient] = useState<Map<string, DueReviewCounts>>(
    () => new Map(),
  );

  const loadDueCounts = useCallback(async () => {
    try {
      const reviews = await photoService.getPhotosWithReviewDue();
      const counts = new Map<string, DueReviewCounts>();
      for (const review of reviews) {
        const status = photoReviewStatus(review.reviewDueAt, {
          warningDays: reviewWarningDays,
        });
        const entry =
          counts.get(review.patientId) ?? { due: 0, overdue: 0, scheduled: 0, nextDueAt: null };
        if (status === 'none') {
          // Beyond the alert window — no alarm colour, but the next date
          // still shows so a review months out stays visible.
          entry.scheduled += 1;
        } else {
          entry.due += 1;
          if (status === 'overdue') entry.overdue += 1;
        }
        if (review.reviewDueAt && (!entry.nextDueAt || review.reviewDueAt < entry.nextDueAt)) {
          entry.nextDueAt = review.reviewDueAt;
        }
        counts.set(review.patientId, entry);
      }
      setDueByPatient(counts);
    } catch {
      setDueByPatient(new Map());
    }
  }, [reviewWarningDays]);

  useEffect(() => {
    void loadDueCounts();
  }, [loadDueCounts]);

  // The "photos due for review" badges must track review-affecting actions
  // the same way the sidebar counters do: a review stamped on the phone
  // fires the attention event, and these banners refetch with it.
  useEffect(() => {
    window.addEventListener(ATTENTION_CHANGED_EVENT, loadDueCounts);
    return () => window.removeEventListener(ATTENTION_CHANGED_EVENT, loadDueCounts);
  }, [loadDueCounts]);

  const handleSearch = useCallback(
    (term: string) => {
      search(term);
    },
    [search]
  );

  // A new patient is created from the header dialog; open their file so the
  // next step (consent, capture or upload) is one click away.
  const handlePatientCreated = useCallback(
    (patient: Patient) => {
      router.push(`/patients/view?id=${patient.id}`);
    },
    [router]
  );

  // Uploads can create the patient too — refresh so a new row appears at the
  // top (most recent photo activity) without leaving the list.
  const handleUploadSaved = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Patients"
        description="Search and review patient photo timelines."
        actions={
          <>
            <PhotoUpload label="Upload photos" onSaved={handleUploadSaved} />
            <Button onClick={() => setIsAddOpen(true)}>
              <UserPlus className="size-4" />
              Add patient
            </Button>
          </>
        }
      />

      <PatientList
        patients={patients}
        isLoading={isLoading}
        error={error}
        onSearch={handleSearch}
        dueByPatient={dueByPatient}
      />

      <AddPatientDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onCreated={handlePatientCreated}
      />
    </div>
  );
}
