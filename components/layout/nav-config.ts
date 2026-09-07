/**
 * Shared navigation config for the (dashboard) chrome: the sidebar
 * (left/right) and the top-tabs layout render the same items and badges.
 */

import { useCallback } from 'react';
import {
  Aperture,
  Users,
  Images,
  Columns2,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNotifications } from '@/lib/hooks/use-notifications';

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_SECTIONS: { label: string; items: NavLink[] }[] = [
  {
    label: 'Workspace',
    items: [{ href: '/', label: 'Dashboard', icon: Aperture }],
  },
  {
    label: 'Library',
    items: [
      { href: '/patients', label: 'Patients', icon: Users },
      { href: '/photos', label: 'Photos', icon: Images },
      { href: '/compare', label: 'Compare', icon: Columns2 },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
];

/** Flattened nav items for horizontal (top-tabs) layouts. */
export const NAV_LINKS: NavLink[] = NAV_SECTIONS.flatMap((s) => s.items);

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Pending-action counters per nav item: dashboard carries the total,
 * patients the review-attention subset, settings the admin's approval
 * queue (0 for non-admins — the service gates it).
 */
export function useNavBadges(): (href: string) => number {
  const { counts } = useNotifications();

  return useCallback(
    (href: string): number => {
      if (!counts) return 0;
      switch (href) {
        case '/':
          return counts.total;
        case '/patients':
          return (
            counts.reviewOverdue +
            counts.reviewDueSoon +
            counts.reviewStale +
            counts.photoReviewOverdue +
            counts.photoReviewDueSoon
          );
        case '/settings':
          return counts.pendingSignups;
        default:
          return 0;
      }
    },
    [counts],
  );
}
