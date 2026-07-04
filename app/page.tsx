/**
 * Home / hub page.
 * Entry point for the app — links to capture and patient list.
 * ponytail: no chrome, no nav bar elsewhere yet; this IS the navigation.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <svg
            className="w-8 h-8 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">Camog</h1>
        <p className="text-muted-foreground text-lg">
          Clinical photo documentation
        </p>

        {(patientCount !== null || photoCount !== null) && (
          <p className="text-sm text-muted-foreground mt-4">
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
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Capture Photo
        </Button>

        <Button
          size="lg"
          variant="outline"
          className="h-32 flex-col gap-2 text-base"
          onClick={() => router.push('/patients')}
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          View Patients
        </Button>
      </div>
    </div>
  );
}
