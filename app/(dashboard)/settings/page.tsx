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

import type { Clinician } from '@/types/clinician';
import type { BodyPart } from '@/types/body-part';
import { BodyPartLabels, BODY_PARTS as BodyPartValues } from '@/types/body-part';

import { ChangePasscodeForm } from '@/components/settings/change-passcode-form';
import { UsersPanel } from '@/components/settings/users-panel';
import { InvitationsPanel } from '@/components/settings/invitations-panel';
import { AppSettingsPanel } from '@/components/settings/app-settings-panel';
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
          {isAdmin && <TabsTrigger value="invitations">Invitations</TabsTrigger>}
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
          <TabsContent value="invitations" className="mt-6">
            <InvitationsPanel />
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
  async function updatePrefs(patch: Partial<Clinician['preferences']>) {
    try {
      await authService.updatePreferences(patch);
      await onchanged();
      toast.success('Preference saved');
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

        <PreferenceRow
          title="Show deleted photos"
          description="Display soft-deleted records in timelines."
          checked={clinician.preferences.showDeletedPhotos}
          onCheckedChange={(v) => updatePrefs({ showDeletedPhotos: v })}
        />

        <PreferenceRow
          title="Auto-compress photos"
          description="Downscale large captures before storing."
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
