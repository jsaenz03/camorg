/**
 * Home / hub page.
 * Entry point for the app — links to capture and patient list.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Users, Aperture } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { patientService } from '@/lib/services/patient-service';

export default function HomePage() {
  const router = useRouter();
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [photoCount, setPhotoCount] = useState<number | null>(null);

  useEffect(() => {
    // ponytail: best-effort stats on the landing page. If the DB isn't ready
    // (e.g. running outside Tauri), we just show the buttons without stats.
    (async () => {
      try {
        const patients = await patientService.getAllPatients({ includeArchived: true });
        setPatientCount(patients.length);
        const refreshed = await Promise.all(
          patients.map((p) => patientService.getPatientWithAccurateCount(p.id))
        );
        setPhotoCount(refreshed.reduce((sum, p) => sum + p.photoCount, 0));
      } catch {
        // Storage unavailable — leave stats null.
      }
    })();
  }, []);

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <div className="flex flex-col items-center text-center mb-12">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 mb-6">
          <Aperture className="size-8 text-primary" />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight mb-3">Camog</h1>
        <p className="text-muted-foreground text-lg">
          Clinical photo documentation
        </p>

        {(patientCount !== null || photoCount !== null) && (
          <p className="text-sm text-muted-foreground mt-4 tabular-nums">
            {patientCount !== null && `${patientCount} patient${patientCount === 1 ? '' : 's'}`}
            {patientCount !== null && photoCount !== null && ' · '}
            {photoCount !== null && `${photoCount} photo${photoCount === 1 ? '' : 's'}`}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Button
          size="lg"
          className="h-32 flex-col gap-2 text-base"
          onClick={() => router.push('/capture')}
        >
          <Camera className="size-6" />
          Capture Photo
        </Button>

        <Button
          size="lg"
          variant="outline"
          className="h-32 flex-col gap-2 text-base"
          onClick={() => router.push('/patients')}
        >
          <Users className="size-6" />
          View Patients
        </Button>
      </div>
    </div>
  );
}
