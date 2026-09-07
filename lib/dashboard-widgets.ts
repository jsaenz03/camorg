/**
 * Dashboard widget registry (pure data + logic — no React).
 *
 * The home page renders its sections through this registry so users can
 * reorder, hide and re-add them ("Customise" mode). The stored preference is
 * an ordered list of widget ids (null = the default layout); unknown ids from
 * a newer app version are ignored at render time but preserved on save.
 */

export type DashboardWidgetId =
  | 'stats'
  | 'attention'
  | 'recent-actions'
  | 'chart-photos-over-time'
  | 'chart-body-part'
  | 'chart-patient-growth'
  | 'calendar'
  | 'recent-patients'
  | 'latest-photos';

export interface DashboardWidgetDef {
  id: DashboardWidgetId;
  /** Shown in the add-widget picker and the edit-mode tooltip. */
  label: string;
  /** One-line hint for the add-widget picker. */
  description: string;
  /** Column span on the desktop (lg) 3-column grid. */
  span: 1 | 2 | 3;
}

/** Tailwind col-span class per span value (lg breakpoint, 3-col grid). */
export const WIDGET_SPAN_CLASSES: Record<1 | 2 | 3, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};

export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    id: 'stats',
    label: 'Stats overview',
    description: 'Patients, photos and review KPIs.',
    span: 3,
  },
  {
    id: 'attention',
    label: 'Needs attention',
    description: 'Reviews due or overdue, consent and approval alerts.',
    span: 2,
  },
  {
    id: 'recent-actions',
    label: 'Recent actions',
    description: 'Latest captures, reviews and edits.',
    span: 1,
  },
  {
    id: 'chart-photos-over-time',
    label: 'Photos over time',
    description: 'Capture volume trend chart.',
    span: 1,
  },
  {
    id: 'chart-body-part',
    label: 'Photos by body part',
    description: 'Where photos are being taken.',
    span: 1,
  },
  {
    id: 'chart-patient-growth',
    label: 'Patient growth',
    description: 'New patients over time.',
    span: 1,
  },
  {
    id: 'calendar',
    label: 'Activity calendar',
    description: 'Capture activity by day; click a day to filter photos.',
    span: 1,
  },
  {
    id: 'recent-patients',
    label: 'Recent patients',
    description: 'Latest patient cards.',
    span: 2,
  },
  {
    id: 'latest-photos',
    label: 'Latest photos',
    description: 'Newest captures, or the selected day\u2019s.',
    span: 3,
  },
];

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetId[] =
  DASHBOARD_WIDGETS.map((w) => w.id);

const KNOWN_IDS = new Set<string>(DEFAULT_DASHBOARD_WIDGETS);

export function isDashboardWidgetId(id: string): id is DashboardWidgetId {
  return KNOWN_IDS.has(id);
}

/**
 * Stored preference → the ordered list of widgets to render. null/undefined
 * (never customised) yields the default layout; duplicates and unknown ids
 * are dropped, and any known widget missing from a customised list is simply
 * hidden (re-addable from the picker).
 */
export function resolveDashboardWidgets(
  stored: string[] | null | undefined,
): DashboardWidgetId[] {
  if (!stored) return [...DEFAULT_DASHBOARD_WIDGETS];
  const seen = new Set<string>();
  return stored.filter((id): id is DashboardWidgetId => {
    if (!isDashboardWidgetId(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Move the item at `from` to `to`, shifting the items in between. */
export function moveWidget<T>(list: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Widgets available to add: known widgets not currently shown. */
export function hiddenDashboardWidgets(
  order: DashboardWidgetId[],
): DashboardWidgetDef[] {
  const shown = new Set(order);
  return DASHBOARD_WIDGETS.filter((w) => !shown.has(w.id));
}
