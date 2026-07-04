'use client';

/**
 * Settings page.
 *
 * Always shows: passcode change.
 * Admin-only: tabs for Users, Invitations, App settings.
 */

import { useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { authService } from '@/lib/services/auth-service';
import { toast } from 'sonner';

import type { Clinician } from '@/types/clinician';
import type { BodyPart } from '@/types/body-part';
import { BodyPartLabels, BODY_PARTS as BodyPartValues } from '@/types/body-part';

import { ChangePasscodeForm } from '@/components/settings/change-passcode-form';
import { UsersPanel } from '@/components/settings/users-panel';
import { InvitationsPanel } from '@/components/settings/invitations-panel';
import { AppSettingsPanel } from '@/components/settings/app-settings-panel';

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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type Tab = 'profile' | 'users' | 'invitations' | 'app';

export default function SettingsPage() {
  const { clinician, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');

  if (!clinician) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const isAdmin = clinician.role === 'admin';

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Badge variant="secondary">{clinician.role}</Badge>
      </div>

      <div className="mb-6 flex gap-1 border-b">
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
          Profile
        </TabButton>
        {isAdmin && (
          <>
            <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
              Users
            </TabButton>
            <TabButton active={tab === 'invitations'} onClick={() => setTab('invitations')}>
              Invitations
            </TabButton>
            <TabButton active={tab === 'app'} onClick={() => setTab('app')}>
              App
            </TabButton>
          </>
        )}
      </div>

      {tab === 'profile' && (
        <div className="space-y-4">
          <ProfileCard clinician={clinician} onchanged={refresh} />
          <ChangePasscodeForm onchanged={refresh} />
        </div>
      )}
      {tab === 'users' && isAdmin && <UsersPanel currentUserId={clinician.id} />}
      {tab === 'invitations' && isAdmin && <InvitationsPanel />}
      {tab === 'app' && isAdmin && <AppSettingsPanel />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function ProfileCard({
  clinician,
  onchanged,
}: {
  clinician: Clinician;
  onchanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function updatePrefs(patch: Partial<Clinician['preferences']>) {
    setSaving(true);
    try {
      await authService.updatePreferences(patch);
      await onchanged();
      toast.success('Preference saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
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
                defaultBodyPart:
                  v === '__none__' ? null : (v as BodyPart),
              })
            }
          >
            <SelectTrigger className="w-full" disabled={saving}>
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

        <label className="flex items-center justify-between rounded-md border p-3 text-sm">
          <span>
            <span className="font-medium">Show deleted photos</span>
            <span className="block text-xs text-muted-foreground">
              Display soft-deleted records in timelines.
            </span>
          </span>
          <input
            type="checkbox"
            className="size-4"
            checked={clinician.preferences.showDeletedPhotos}
            onChange={(e) =>
              updatePrefs({ showDeletedPhotos: e.target.checked })
            }
            disabled={saving}
          />
        </label>

        <label className="flex items-center justify-between rounded-md border p-3 text-sm">
          <span>
            <span className="font-medium">Auto-compress photos</span>
            <span className="block text-xs text-muted-foreground">
              Downscale large captures before storing.
            </span>
          </span>
          <input
            type="checkbox"
            className="size-4"
            checked={clinician.preferences.autoCompressPhotos}
            onChange={(e) =>
              updatePrefs({ autoCompressPhotos: e.target.checked })
            }
            disabled={saving}
          />
        </label>
      </CardContent>
    </Card>
  );
}
