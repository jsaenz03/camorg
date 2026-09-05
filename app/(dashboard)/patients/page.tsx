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
import { PatientList } from '@/components/patient/patient-list';
import { PageHeader } from '@/components/page-header';
import { usePatients } from '@/lib/hooks/use-patients';
import { useBranding } from '@/components/branding-boot';
import { photoService } from '@/lib/services/photo-service';
import { photoReviewStatus } from '@/lib/utils/photo-review';
import { ATTENTION_CHANGED_EVENT } from '@/lib/services/attention-events';
import type { DueReviewCounts } from '@/components/patient/photo-review-due-badge';

export default function PatientsPage() {
  const { patients, isLoading, error, search } = usePatients({
    includeArchived: false,
  });
  const { reviewWarningDays } = useBranding();
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

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Patients"
        description="Search and review patient photo timelines."
      />

      <PatientList
        patients={patients}
        isLoading={isLoading}
        error={error}
        onSearch={handleSearch}
        dueByPatient={dueByPatient}
      />
    </div>
  );
}
