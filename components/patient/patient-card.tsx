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
import { formatLastPhotoTime } from '@/lib/utils/date-formatting';

interface PatientCardProps {
  patient: Patient;
  onClick?: () => void;
}

/**
 * PatientCard displays patient information with photo stats and an access badge
 * (Org-wide / Private) so the doctor understands the visibility at a glance.
 */
export function PatientCard({ patient, onClick }: PatientCardProps) {
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
          </div>
          <Badge variant="secondary" className="shrink-0">
            {patient.photoCount} {patient.photoCount === 1 ? 'photo' : 'photos'}
          </Badge>
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
