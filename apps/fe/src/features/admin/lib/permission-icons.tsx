/**
 * Icon mapping for ThinkCocoa permissions.
 *
 * Keys mirror the 13 resources in `PERMISSION_CATALOG` (see
 * `packages/shared/src/constants/permissions.ts`). If the catalog grows
 * via the admin UI, add the matching icon here; unknown resources fall
 * back to `Shield` so nothing crashes.
 *
 * - `resourceIcon(resource)` — domain icon for a `resource:*` group.
 * - `actionIcon(action)`     — verb icon for a `*:action`.
 * - `permissionIcon(code)`   — splits `resource:action` and prefers the
 *                              action icon; falls back to resource.
 */

import {
  Bell,
  Building2,
  Circle,
  ClipboardCheck,
  Download,
  Eye,
  FastForward,
  FileBarChart,
  GraduationCap,
  Handshake,
  KeyRound,
  LandPlot,
  LayoutDashboard,
  type LucideIcon,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  UserCog,
  Users,
} from 'lucide-react';
import { createElement, forwardRef } from 'react';
import type { IntlShape } from 'react-intl';

/** Truck flipped horizontally — matches the sidebar's Secondary Evac
 *  glyph (depot → port points left). */
const TruckLeft = forwardRef<SVGSVGElement, React.ComponentProps<typeof Truck>>(
  ({ style, ...props }, ref) =>
    createElement(Truck, { ref, ...props, style: { transform: 'scaleX(-1)', ...style } }),
) as unknown as LucideIcon;
TruckLeft.displayName = 'TruckLeft';

// Mirror the sidebar's resource → icon mapping (`menu-settings.ts`)
// so the same resource shows the same glyph everywhere it appears.
// Resource codes are singular per the BE convention.
export const RESOURCE_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  farmer: Users,
  parcel: LandPlot,
  vsla: PiggyBank,
  training: GraduationCap,
  coaching: Handshake,
  purchase: ShoppingCart,
  primary_evac: Truck,
  secondary_evac: TruckLeft,
  inspection: ClipboardCheck,
  clmrs: ShieldAlert,
  report: FileBarChart,
  cooperative: Building2,
  user: UserCog,
  role: Shield,
  permission: KeyRound,
  sync: RefreshCw,
};

/**
 * Resource display order — mirrors the sidebar menu top-to-bottom
 * (`menu-settings.ts`) so the Permissions list reads in the same order
 * as the nav. Resources not in the menu bubble to the end alphabetically.
 */
export const RESOURCE_ORDER: readonly string[] = [
  'dashboard',
  'farmer',
  'parcel',
  'vsla',
  'training',
  'coaching',
  'purchase',
  'primary_evac',
  'secondary_evac',
  'inspection',
  'clmrs',
  'report',
  'cooperative',
  'user',
  'role',
  'permission',
  'sync',
];

/** Friendly display label for a resource group — mirrors the sidebar
 *  wording. Special-cases the evac chain; everything else is
 *  underscore→space + word-capitalized (`cooperative` → "Cooperative"). */
const RESOURCE_LABELS: Record<string, string> = {
  primary_evac: '1st Evac',
  secondary_evac: '2nd Evac',
};
export function formatResourceLabel(resource: string): string {
  if (RESOURCE_LABELS[resource]) return RESOURCE_LABELS[resource];
  return resource
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * i18n'd resource-group label. Looks up `admin.perm.resource.<code>` and
 * falls back to the English-derived `formatResourceLabel` for any resource
 * the catalog grows that we haven't translated yet.
 */
export function resourceLabel(intl: IntlShape, resource: string): string {
  return intl.formatMessage({
    id: `admin.perm.resource.${resource}`,
    defaultMessage: formatResourceLabel(resource),
  });
}

/**
 * i18n'd action (verb) label. Looks up `admin.perm.action.<code>`; falls
 * back to the permission's own `name` (server data) or a capitalized code.
 */
export function actionLabel(intl: IntlShape, action: string, fallback?: string): string {
  return intl.formatMessage({
    id: `admin.perm.action.${action}`,
    defaultMessage: fallback || formatResourceLabel(action),
  });
}

/** Sort comparator putting resources in sidebar-menu order, then any
 *  unknown resource alphabetically after the known ones. */
export function resourceSort(a: string, b: string): number {
  const ai = RESOURCE_ORDER.indexOf(a);
  const bi = RESOURCE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export const ACTION_ICONS: Record<string, LucideIcon> = {
  create: Plus,
  read: Eye,
  update: Pencil,
  delete: Trash2,
  notification: Bell,
  import: Upload,
  export: Download,
  // Sync-job verbs — live only on the `sync` resource now (per-resource
  // `<resource>:sync` was retired). `run` triggers one job, `run_all`
  // triggers every job, `config` edits sync settings.
  run: Play,
  run_all: FastForward,
  config: Settings,
};

/**
 * Canonical display order for actions across the admin UI: CRUD first
 * (create → read → update → delete), then the remaining verbs. Actions
 * not in this list bubble to the end alphabetically — keeps the order
 * stable when a new action verb appears in the catalog before the
 * front-end is updated.
 */
export const ACTION_ORDER: readonly string[] = [
  'create',
  'read',
  'update',
  'delete',
  'notification',
  'import',
  'export',
  'run',
  'run_all',
  'config',
];

/** Sort comparator that puts known actions in `ACTION_ORDER` first
 *  (in that order), then any unknown action alphabetically. */
export function actionSort(a: string, b: string): number {
  const ai = ACTION_ORDER.indexOf(a);
  const bi = ACTION_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export function resourceIcon(resource: string): LucideIcon {
  return RESOURCE_ICONS[resource] ?? Shield;
}

export function actionIcon(action: string): LucideIcon {
  return ACTION_ICONS[action] ?? Circle;
}

/**
 * Pick an icon for a full `resource:action` permission code.
 * Prefers the action icon (more specific); falls back to resource.
 */
export function permissionIcon(code: string): LucideIcon {
  const [resource, action] = code.split(':');
  if (action && ACTION_ICONS[action]) return ACTION_ICONS[action];
  if (resource && RESOURCE_ICONS[resource]) return RESOURCE_ICONS[resource];
  return Shield;
}
