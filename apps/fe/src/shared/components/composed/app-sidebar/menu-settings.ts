import type { PermissionCode } from '@thinkcocoa/shared';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  ClipboardCheck,
  FileBarChart,
  GraduationCap,
  Handshake,
  KeyRound,
  LandPlot,
  LayoutDashboard,
  PiggyBank,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import { createElement, forwardRef } from 'react';

/**
 * Truck flipped horizontally — used for Secondary Evacuation so the
 * vehicle visually points left (depot → port direction in our nav).
 * Wraps the standard `Truck` glyph with `scaleX(-1)`.
 */
const TruckLeft = forwardRef<SVGSVGElement, React.ComponentProps<typeof Truck>>(
  ({ style, ...props }, ref) =>
    createElement(Truck, {
      ref,
      ...props,
      style: { transform: 'scaleX(-1)', ...style },
    }),
) as unknown as LucideIcon;
TruckLeft.displayName = 'TruckLeft';

import { BRAND_GRADIENT } from '@/lib/brand-palette';

/**
 * Sidebar entry. `permission` gates both the menu item (hidden if absent)
 * and — matched against the same string in `routes-with-permission.ts` —
 * the route guard. Always-visible items (e.g. profile) omit the field.
 *
 * `iconColor` is the brand-tinted hex per Pencil `KoKiZ` — the icon stays
 * full-strength even when the row is inactive (the *label* dims via the
 * sidebar's muted-foreground class, but the icon doesn't inherit that).
 * Picked from the spec verbatim, not theme-derived, so dark-mode parity
 * is intentional rather than accidental.
 */
export interface MenuItem {
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /** Hex color for the icon (Pencil-spec'd brand tint). */
  iconColor: string;
  /** Omit to make the item visible to anyone authenticated. */
  permission?: PermissionCode;
}

export interface MenuSection {
  labelKey: string;
  items: MenuItem[];
}

// Every icon carries the SAME brand green. The sidebar used to walk a
// 13-stop gradient top-to-bottom — espresso → green → yellow, one stop per
// row — which made the icon colour read as data ("why is Users yellow and
// Inspections green?") when it carries no meaning at all. A single tint
// lets the icons recede and the labels do the work; the active-row pill is
// what marks position now.
const MENU_ICON = BRAND_GRADIENT[7]; // sprout green — the brand's signature stop

export const menuSections: MenuSection[] = [
  {
    labelKey: 'sidebar.main',
    items: [
      {
        // Dashboard is the system-wide overview, gated on `dashboard:read`.
        // Every canonical role is granted it (see `ROLE_GRANTS`), so it
        // stays the default landing — but a role stripped of the perm
        // hits the 403 page on `/` instead.
        labelKey: 'navigation.dashboard',
        href: '/',
        icon: LayoutDashboard,
        iconColor: MENU_ICON,
        permission: 'dashboard:read',
      },
      {
        labelKey: 'navigation.farmers',
        href: '/farmers',
        icon: Users,
        iconColor: MENU_ICON,
        permission: 'farmer:read',
      },
      {
        labelKey: 'navigation.farms',
        href: '/farms',
        icon: LandPlot,
        iconColor: MENU_ICON,
        permission: 'parcel:read',
      },
      {
        labelKey: 'navigation.vsla',
        href: '/vsla',
        icon: PiggyBank,
        iconColor: MENU_ICON,
        // VSLA reuses `farmer:read` for now — same audience as farmers/
        // parcels. When a dedicated `vsla:read` lands we'll swap this.
        permission: 'farmer:read',
      },
    ],
  },
  {
    labelKey: 'sidebar.operations',
    items: [
      {
        labelKey: 'navigation.training',
        href: '/training',
        icon: GraduationCap,
        iconColor: MENU_ICON,
        permission: 'training:read',
      },
      {
        labelKey: 'navigation.coaching',
        href: '/coaching',
        icon: Handshake,
        iconColor: MENU_ICON,
        permission: 'coaching:read',
      },
    ],
  },
  {
    // Supply-chain ordered top-to-bottom (origin → port).
    // The three rows form the canonical chain:
    //   Society Purchase  →  Primary Evac  →  Secondary Evac.
    labelKey: 'sidebar.traceability',
    items: [
      {
        labelKey: 'navigation.purchases',
        href: '/purchases',
        icon: ShoppingCart,
        iconColor: MENU_ICON,
        permission: 'purchase:read',
      },
      {
        labelKey: 'navigation.primaryEvac',
        href: '/primary-evacuation',
        icon: Truck,
        iconColor: MENU_ICON,
        permission: 'primary_evac:read',
      },
      {
        labelKey: 'navigation.secondaryEvac',
        href: '/secondary-evacuation',
        icon: TruckLeft,
        iconColor: MENU_ICON,
        permission: 'secondary_evac:read',
      },
    ],
  },
  {
    labelKey: 'sidebar.compliance',
    items: [
      {
        labelKey: 'navigation.inspections',
        href: '/inspections',
        icon: ClipboardCheck,
        iconColor: MENU_ICON,
        permission: 'inspection:read',
      },
      // CLMRS lands under Compliance next to Inspections. The single
      // /clmrs page has two internal tabs — Pending Flags (Modules B/C
      // output) and Case Register (Module D). Gated on `farmer:read`
      // for the initial rollout — swap to a dedicated `clmrs:read`
      // when the BE lands.
      {
        labelKey: 'navigation.clmrs',
        href: '/clmrs',
        icon: ShieldAlert,
        iconColor: MENU_ICON,
        permission: 'farmer:read',
      },
    ],
  },
  {
    labelKey: 'sidebar.reporting',
    items: [
      {
        labelKey: 'navigation.reports',
        href: '/reports',
        icon: FileBarChart,
        iconColor: MENU_ICON,
        permission: 'report:read',
      },
    ],
  },
  {
    labelKey: 'sidebar.admin',
    items: [
      {
        labelKey: 'navigation.adminCooperatives',
        href: '/admin/cooperatives',
        icon: Building2,
        iconColor: MENU_ICON,
        permission: 'cooperative:read',
      },
      {
        labelKey: 'navigation.adminUsers',
        href: '/admin/users',
        icon: UserCog,
        iconColor: MENU_ICON,
        permission: 'user:read',
      },
      {
        labelKey: 'navigation.adminRoles',
        href: '/admin/roles',
        icon: Shield,
        iconColor: MENU_ICON,
        permission: 'role:read',
      },
      {
        labelKey: 'navigation.adminPermissions',
        href: '/admin/permissions',
        icon: KeyRound,
        iconColor: MENU_ICON,
        permission: 'permission:read',
      },
      {
        labelKey: 'navigation.adminSync',
        href: '/admin/sync',
        icon: RefreshCw,
        iconColor: MENU_ICON,
        permission: 'sync:config',
      },
    ],
  },
];
