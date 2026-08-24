import type { PermissionCode } from '@kuanadata/shared';
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
  Ship,
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

/**
 * One brand stop per GROUP — not per row.
 *
 * Walking a stop per row (the original) made the colour read as data:
 * "why is Users yellow and Inspections green?" when it meant nothing.
 * Flattening all 17 to one green fixed that but left the rail
 * undifferentiated. Per-group is the middle ground — the colour now
 * encodes exactly one true thing, which section a row belongs to, and it
 * reinforces the group labels instead of competing with them.
 *
 * All six stops come from the DARKER half of the gradient: light mode
 * renders the hex verbatim (`brandTintForTheme` only lifts for dark), and
 * the lime/yellow stops wash out against the rail's own tint. Dark mode
 * raises each to a lightness floor, so the walk survives both themes.
 */
const GROUP_TINT = {
  main: BRAND_GRADIENT[1], // s2  — cocoa
  operations: BRAND_GRADIENT[2], // s3  — sienna
  traceability: BRAND_GRADIENT[3], // s4  — deep forest
  compliance: BRAND_GRADIENT[5], // s6  — olive
  reporting: BRAND_GRADIENT[6], // s7  — apple green
  admin: BRAND_GRADIENT[8], // s9  — light green
} as const;

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
        iconColor: GROUP_TINT.main,
        permission: 'dashboard:read',
      },
      {
        labelKey: 'navigation.farmers',
        href: '/farmers',
        icon: Users,
        iconColor: GROUP_TINT.main,
        permission: 'farmer:read',
      },
      {
        labelKey: 'navigation.farms',
        href: '/farms',
        icon: LandPlot,
        iconColor: GROUP_TINT.main,
        permission: 'parcel:read',
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
        iconColor: GROUP_TINT.operations,
        permission: 'training:read',
      },
      {
        labelKey: 'navigation.coaching',
        href: '/coaching',
        icon: Handshake,
        iconColor: GROUP_TINT.operations,
        permission: 'coaching:read',
      },
      {
        labelKey: 'navigation.vsla',
        href: '/vsla',
        icon: PiggyBank,
        iconColor: GROUP_TINT.operations,
        // Gated on `vsla:read` — the SAME perm every `/api/vsla` route
        // requires. Was borrowing `farmer:read` (which every role has), so
        // the item showed for everyone but the page's own list/stats calls
        // 403'd and bounced them to /403.
        permission: 'vsla:read',
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
        iconColor: GROUP_TINT.traceability,
        permission: 'purchase:read',
      },
      {
        labelKey: 'navigation.primaryEvac',
        href: '/primary-evacuation',
        icon: Truck,
        iconColor: GROUP_TINT.traceability,
        permission: 'primary_evac:read',
      },
      {
        labelKey: 'navigation.secondaryEvac',
        href: '/secondary-evacuation',
        icon: TruckLeft,
        iconColor: GROUP_TINT.traceability,
        permission: 'secondary_evac:read',
      },
      {
        labelKey: 'navigation.export',
        href: '/export',
        icon: Ship,
        iconColor: GROUP_TINT.traceability,
        // End of the supply chain — same audience as secondary transfer.
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
        iconColor: GROUP_TINT.compliance,
        permission: 'inspection:read',
      },
      // CLMRS lands under Compliance next to Inspections. The single
      // /clmrs page has two internal tabs — Pending Flags (Modules B/C
      // output) and Case Register (Module D). Gated on `clmrs:read`, the
      // SAME perm the BE `/api/clmrs-records` routes require — so the item
      // only shows to roles that can actually read the register (it used
      // to borrow `farmer:read`, which every role has, so the menu showed
      // for everyone but the data 403'd and bounced them to /403).
      {
        labelKey: 'navigation.clmrs',
        href: '/clmrs',
        icon: ShieldAlert,
        iconColor: GROUP_TINT.compliance,
        permission: 'clmrs:read',
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
        iconColor: GROUP_TINT.reporting,
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
        iconColor: GROUP_TINT.admin,
        permission: 'cooperative:read',
      },
      {
        labelKey: 'navigation.adminUsers',
        href: '/admin/users',
        icon: UserCog,
        iconColor: GROUP_TINT.admin,
        permission: 'user:read',
      },
      {
        labelKey: 'navigation.adminRoles',
        href: '/admin/roles',
        icon: Shield,
        iconColor: GROUP_TINT.admin,
        permission: 'role:read',
      },
      {
        labelKey: 'navigation.adminPermissions',
        href: '/admin/permissions',
        icon: KeyRound,
        iconColor: GROUP_TINT.admin,
        permission: 'permission:read',
      },
      {
        labelKey: 'navigation.adminSync',
        href: '/admin/sync',
        icon: RefreshCw,
        iconColor: GROUP_TINT.admin,
        permission: 'sync:config',
      },
    ],
  },
];
