/**
 * PhotoMoveDialog
 *
 * Small dialog for filing a photo to a different patient — the
 * misfiled-capture case. The search runs through
 * patientService.searchPatients (already access-filtered); non-admins
 * additionally only see patients they own, because moving INTO a patient is
 * a write and share-viewers are read-only — the same rule
 * accessService.assertCanManagePatient enforces in the service. Picking a
 * row only selects it; the Move button commits, so a mis-tap can't file the
 * photo to the wrong record twice.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Check, FolderInput, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Patient } from '@/types/patient';
import type { PhotoRecord } from '@/types/photo';
import { patientService } from '@/lib/services/patient-service';
import { photoService } from '@/lib/services/photo-service';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PhotoMoveDialogProps {
  photo: PhotoRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the move commits — the photo no longer belongs to the
      opening context, so the parent usually closes and refreshes. */
  onMoved: (target: Patient) => void;
}

export function PhotoMoveDialog({ photo, open, onOpenChange, onMoved }: PhotoMoveDialogProps) {
  const { clinician } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  // False when the current clinician can't file photos into this patient's
  // record (share-viewer) — the dialog explains instead of offering a
  // search that could only ever fail at the service guard.
  const [canManageSource, setCanManageSource] = useState(true);
  // Latest-wins guard: keystrokes race the local SQLite lookups.
  const searchSeq = useRef(0);

  // Reset on open + source manage check (an admin or the patient's owner).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSelectedId(null);
    setIsMoving(false);
    let mounted = true;
    patientService
      .getPatientById(photo.patientId)
      .then((source) => {
        if (mounted) {
          setCanManageSource(
            clinician?.role === 'admin' || source?.ownerClinicianId === clinician?.id,
          );
        }
      })
      .catch(() => {
        if (mounted) setCanManageSource(false);
      });
    return () => {
      mounted = false;
    };
  }, [open, photo.patientId, clinician]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    patientService
      .searchPatients(trimmed)
      .then((list) => {
        if (seq !== searchSeq.current) return;
        // Targets must be manageable: admins manage everything, other
        // clinicians only the patients they own (mirror of the service
        // guard). The photo's current patient is not a destination.
        const ownOnly = clinician?.role !== 'admin';
        setResults(
          list
            .filter(
              (p) => p.id !== photo.patientId && (!ownOnly || p.ownerClinicianId === clinician?.id),
            )
            .slice(0, 8),
        );
      })
      .catch(() => {
        if (seq === searchSeq.current) setResults([]);
      });
  }, [query, open, photo.patientId, clinician]);

  const selected = results.find((p) => p.id === selectedId) ?? null;

  const handleMove = async () => {
    if (!selected || isMoving) return;
    setIsMoving(true);
    try {
      await photoService.movePhoto(photo.id, selected.id);
      toast.success(`Photo moved to ${selected.name}`);
      onMoved(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setIsMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move photo to another patient</DialogTitle>
          <DialogDescription>
            For a photo filed to the wrong patient. The photo, its notes, body
            part and attached result files move together; the move is recorded
            in the audit log.
          </DialogDescription>
        </DialogHeader>

        {!canManageSource ? (
          <p className="text-sm text-muted-foreground">
            You can view this patient&apos;s record but can&apos;t file photos
            into it — only the patient&apos;s owner or an admin can move
            photos.
          </p>
        ) : (
          <div className="space-y-4">
            {photo.lesionGroup && (
              <p className="text-xs text-muted-foreground">
                This photo will leave its current series ({photo.lesionGroup}).
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="move-patient-search">Correct patient</Label>
              <Input
                id="move-patient-search"
                placeholder="Search by name or date of birth"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedId === p.id
                      ? // Single-edge selection: border + tint. A ring stacked
                        // on the border read as a thick double edge at the
                        // corners; the Check icon does the confirming.
                        'border-primary bg-primary/5'
                      : 'hover:border-primary/60'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    {p.dateOfBirth && (
                      <span className="block text-xs text-muted-foreground">
                        DOB {format(p.dateOfBirth, 'dd/MM/yyyy')}
                      </span>
                    )}
                  </span>
                  {selectedId === p.id && (
                    <Check className="size-4 shrink-0 text-primary" aria-hidden />
                  )}
                </button>
              ))}
              {query.trim() && results.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  No patients match &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
              {!query.trim() && (
                <p className="py-2 text-sm text-muted-foreground">
                  Start typing to search — nothing moves until you confirm.
                </p>
              )}
            </div>
          </div>
        )}

        {canManageSource && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isMoving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleMove} disabled={!selected || isMoving}>
              {isMoving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FolderInput className="size-4" />
              )}
              {selected ? `Move to ${selected.name}` : 'Move photo'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
