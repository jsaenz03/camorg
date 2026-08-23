'use client';

/**
 * Settings page.
 *
 * Always shows: passcode change.
 * Admin-only: tabs for Users, Invitations, App settings.
 * Uses shadcn Tabs and Switch (replaces the prior hand-rolled tab bar and
 * native checkboxes).
 */

import { useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/services/auth-service';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';

import type { Clinician } from '@/types/clinician';
import type { BodyPart } from '@/types/body-part';
import { BodyPartLabels, BODY_PARTS as BodyPartValues } from '@/types/body-part';

import { ChangePasscodeForm } from '@/components/settings/change-passcode-form';
import { UsersPanel } from '@/components/settings/users-panel';
import { InvitationsPanel } from '@/components/settings/invitations-panel';
import { AppSettingsPanel } from '@/components/settings/app-settings-panel';
import { PatientAccessPanel } from '@/components/settings/patient-access-panel';
import { StoragePanel } from '@/components/settings/storage-panel';
import { BackupPanel } from '@/components/settings/backup-panel';
import { AuditLogPanel } from '@/components/settings/audit-log-panel';
import { LicencePanel } from '@/components/settings/licence-panel';
import { PageHeader } from '@/components/page-header';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

/** Personal auto-logout choices; `__org__` falls back to the admin's org-wide setting. */
const AUTO_LOGOUT_OPTIONS = [
  { value: '__org__', label: 'Use organisation default' },
  { value: String(15 * 60_000), label: '15 minutes' },
  { value: String(30 * 60_000), label: '30 minutes' },
  { value: String(60 * 60_000), label: '1 hour' },
  { value: String(4 * 60 * 60_000), label: '4 hours' },
  { value: String(8 * 60 * 60_000), label: '8 hours' },
  { value: String(24 * 60 * 60_000), label: '1 day' },
  { value: String(7 * 24 * 60 * 60_000), label: '1 week' },
  { value: '0', label: 'Never' },
];

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = hours / 24;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export default function SettingsPage() {
  const { clinician, refresh } = useAuth();

  if (!clinician) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-10">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const isAdmin = clinician.role === 'admin';

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        title="Settings"
        description="Manage your profile and application preferences."
        actions={<Badge variant="secondary">{clinician.role}</Badge>}
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="access">Access</TabsTrigger>}
          {isAdmin && <TabsTrigger value="invitations">Invitations</TabsTrigger>}
          {isAdmin && <TabsTrigger value="storage">Storage</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit">Audit</TabsTrigger>}
          {isAdmin && <TabsTrigger value="licence">Licence</TabsTrigger>}
          {isAdmin && <TabsTrigger value="app">App</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="mt-6 space-y-4">
          <ProfileCard clinician={clinician} onchanged={refresh} />
          <ChangePasscodeForm onchanged={refresh} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users" className="mt-6">
            <UsersPanel currentUserId={clinician.id} />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="access" className="mt-6">
            <PatientAccessPanel />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="invitations" className="mt-6">
            <InvitationsPanel />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="storage" className="mt-6 space-y-4">
            <StoragePanel />
            <BackupPanel />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="audit" className="mt-6">
            <AuditLogPanel />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="licence" className="mt-6">
            <LicencePanel />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="app" className="mt-6">
            <AppSettingsPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function ProfileCard({
  clinician,
  onchanged,
}: {
  clinician: Clinician;
  onchanged: () => void;
}) {
  // Org-wide default, shown so "Use organisation default" isn't a mystery box.
  const [orgDefault, setOrgDefault] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    authService
      .getSettings()
      .then((s) => {
        if (!cancelled) setOrgDefault(s.sessionTimeoutMs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function updatePrefs(patch: Partial<Clinician['preferences']>) {
    try {
      await authService.updatePreferences(patch);
      await onchanged();
      toast.success('Preference saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function updateAutoLogout(value: string) {
    const ms = value === '__org__' ? null : Number(value);
    try {
      await authService.updatePreferences({ autoLogoutTimeoutMs: ms });
      // Re-derive the live session's expiry so the new timeout applies now,
      // not just at the next sign-in.
      await authService.refreshSession();
      await onchanged();
      toast.success('Auto sign-out updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>{clinician.username}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Default body part</label>
          <Select
            value={clinician.preferences.defaultBodyPart ?? '__none__'}
            onValueChange={(v) =>
              updatePrefs({
                defaultBodyPart: v === '__none__' ? null : (v as BodyPart),
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No default</SelectItem>
              {BodyPartValues.map((bp) => (
                <SelectItem key={bp} value={bp}>
                  {BodyPartLabels[bp]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Sign me out automatically after</label>
          <Select
            value={
              clinician.preferences.autoLogoutTimeoutMs === null
                ? '__org__'
                : String(clinician.preferences.autoLogoutTimeoutMs)
            }
            onValueChange={updateAutoLogout}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Use organisation default" />
            </SelectTrigger>
            <SelectContent>
              {AUTO_LOGOUT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Applies while you&rsquo;re away — active use keeps you signed in. Tick
            &ldquo;Keep me signed in&rdquo; at sign-in to stay signed in after
            closing the app.
            {orgDefault !== null && (
              <> Organisation default: {formatDuration(orgDefault)}.</>
            )}
          </p>
        </div>

        <PreferenceRow
          title="Show deleted photos"
          description="Display soft-deleted records in timelines."
          checked={clinician.preferences.showDeletedPhotos}
          onCheckedChange={(v) => updatePrefs({ showDeletedPhotos: v })}
        />

        <PreferenceRow
          title="Auto-compress photos"
          description="On: downscale captures to a 1920px JPEG before saving. Off: store full-quality originals (larger files)."
          checked={clinician.preferences.autoCompressPhotos}
          onCheckedChange={(v) => updatePrefs({ autoCompressPhotos: v })}
        />
      </CardContent>
    </Card>
  );
}

function PreferenceRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="pr-4">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
