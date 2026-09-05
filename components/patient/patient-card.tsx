/**
 * PatientCard Component
 *
 * Displays a single patient with photo count and last photo timestamp.
 * Clickable to navigate to patient timeline.
 */

'use client';

import { Images, Globe, Lock } from 'lucide-react';
import type { Patient } from '@/types/patient';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateOfBirth, formatLastPhotoTime } from '@/lib/utils/date-formatting';
import { ReviewBadge } from './review-badge';
import { PhotoReviewDueBadge, type DueReviewCounts } from './photo-review-due-badge';

interface PatientCardProps {
  patient: Patient;
  /** Photos due for review; badge hidden when absent or zero. */
  due?: DueReviewCounts;
  onClick?: () => void;
}

/**
 * PatientCard displays patient information with photo stats and an access badge
 * (Org-wide / Private) so the doctor understands the visibility at a glance.
 */
export function PatientCard({ patient, due, onClick }: PatientCardProps) {
  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
      onClick={onClick}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {patient.name}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {formatLastPhotoTime(patient.lastPhotoAt)}
            </p>
            {patient.dateOfBirth && (
              <p className="text-xs text-muted-foreground mt-0.5">
                DOB {formatDateOfBirth(patient.dateOfBirth)}
              </p>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0">
            {patient.photoCount} {patient.photoCount === 1 ? 'photo' : 'photos'}
          </Badge>
        </div>
        {/* Own row: the long review labels truncate inside the card instead
            of forcing the header row wider than it. ReviewBadge shows the
            next review date whenever one is scheduled — red overdue, amber
            due soon, muted further out — and renders nothing when there is
            no schedule to flag (empty:hidden collapses the row). */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
          <ReviewBadge patient={patient} />
          {due && (
            <PhotoReviewDueBadge
              due={due.due}
              overdue={due.overdue}
              scheduled={due.scheduled}
              nextDueAt={due.nextDueAt}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Images className="size-4" />
            View timeline
          </span>
          {patient.isOrgShared ? (
            <Badge variant="outline" className="gap-1 text-xs">
              <Globe className="size-3" /> Org-wide
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-xs">
              <Lock className="size-3" /> Private
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
