'use client';

/**
 * Admin: patient access panel.
 *
 * Lists every patient in the org with its owner and current sharing mode.
 * Click a patient to open a dialog that toggles the two mutually-exclusive
 * sharing modes:
 *   - Org-wide (visible to every clinician), or
 *   - Specific doctors (a checked subset of org clinicians).
 *
 * All mutations are admin-only and flow through patientService.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, Users, Globe, Lock } from 'lucide-react';

import type { Patient } from '@/types/patient';
import type { Clinician } from '@/types/clinician';
import { patientService } from '@/lib/services/patient-service';
import { authService } from '@/lib/services/auth-service';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface SharingState {
  orgWide: boolean;
  selectedDoctors: Set<string>;
}

export function PatientAccessPanel() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  async function refresh() {
    try {
      const [p, u] = await Promise.all([
        // Admin-only path: include archived so the list is complete.
        patientService.getAllPatients({ includeArchived: true }),
        authService.listUsers(),
      ]);
      setPatients(p);
      setClinicians(u);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function openEditor(p: Patient) {
    setEditing(p);
    setSaving(false);
    try {
      const ids = await patientService.getSharedDoctorIds(p.id);
      setSharing({ orgWide: p.isOrgShared, selectedDoctors: new Set(ids) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load shares');
      setSharing({ orgWide: p.isOrgShared, selectedDoctors: new Set() });
    }
  }

  async function save() {
    if (!editing || !sharing) return;
    setSaving(true);
    try {
      // Apply the active mode. Org-wide is the toggle; specific-doctors is the
      // grant set. Setting both is harmless (OR visibility), but the UI treats
      // them as exclusive — when org-wide is on we clear the grant list.
      await patientService.setOrgShared(editing.id, sharing.orgWide);
      await patientService.setSharedDoctors(
        editing.id,
        sharing.orgWide ? [] : Array.from(sharing.selectedDoctors),
      );
      toast.success(`Access updated for ${editing.name}`);
      setEditing(null);
      setSharing(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const filtered =
    patients?.filter((p) =>
      search.trim() ? p.normalizedName.includes(search.trim().toLowerCase()) : true,
    ) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient access</CardTitle>
        <CardDescription>
          Control which doctors can view each patient&apos;s photos. Default is private to the owner.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search patients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {patients === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No patients found.</p>
        ) : (
          <ul className="divide-y">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => openEditor(p)}
                  className="flex w-full flex-wrap items-center gap-3 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Owner: {p.ownerName ?? '—'}
                    </p>
                  </div>
                  <SharingBadge patient={p} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && (setEditing(null), setSharing(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Access — {editing?.name}</DialogTitle>
            <DialogDescription>
              Owner: {editing?.ownerName ?? '—'}. Choose one sharing mode.
            </DialogDescription>
          </DialogHeader>

          {sharing && (
            <div className="space-y-4">
              {/* Org-wide toggle */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <Globe className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Org-wide</p>
                    <p className="text-xs text-muted-foreground">
                      Every clinician in the organisation can view this patient.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={sharing.orgWide}
                  onCheckedChange={(v) =>
                    setSharing({
                      orgWide: v,
                      selectedDoctors: v ? new Set() : sharing.selectedDoctors,
                    })
                  }
                />
              </div>

              {/* Specific doctors */}
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Specific doctors</p>
                  {sharing.orgWide && (
                    <Badge variant="outline" className="ml-auto">
                      Disabled while org-wide
                    </Badge>
                  )}
                </div>
                <ul className="max-h-56 space-y-1 overflow-auto">
                  {clinicians
                    .filter((c) => c.role !== 'admin')
                    .map((c) => {
                      const checked = sharing.selectedDoctors.has(c.id);
                      const disabled = sharing.orgWide;
                      return (
                        <li key={c.id}>
                          <label
                            className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${
                              disabled ? 'opacity-50' : 'hover:bg-accent/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => {
                                const next = new Set(sharing.selectedDoctors);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                setSharing({ ...sharing, selectedDoctors: next });
                              }}
                            />
                            <span className="flex-1 truncate">{c.displayName}</span>
                            <span className="text-xs text-muted-foreground">{c.username}</span>
                          </label>
                        </li>
                      );
                    })}
                </ul>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => (setEditing(null), setSharing(null))}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !sharing}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SharingBadge({ patient }: { patient: Patient }) {
  if (patient.isOrgShared) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Globe className="size-3" /> Org-wide
      </Badge>
    );
  }
  // Without a join to patient_shares here we can't distinguish "shared with N
  // doctors" from "private" cheaply; show "Shared" optimistically only when the
  // owner isn't the sole viewer. To stay accurate without another query, we
  // surface Private / Org-wide only. Specific-doctor state is visible in the
  // editor dialog.
  return (
    <Badge variant="outline" className="gap-1">
      <Lock className="size-3" /> Private
    </Badge>
  );
}
