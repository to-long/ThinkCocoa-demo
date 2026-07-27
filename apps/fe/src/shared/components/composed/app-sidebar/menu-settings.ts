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
  Map,
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

// 13-stop brand gradient pulled from the shared palette
// (`@/lib/brand-palette` → Pencil `STuuC`). Reading top→bottom flows
// espresso → cocoa → sienna → olive → leaf → golden yellow.
// Stops are aliased here as `s1..s13` so the menu definitions below
// stay readable; the source of truth lives in `brand-palette.ts`.
// Each menu row consumes ONE gradient stop in render-order
// top-to-bottom — the rendered sidebar reads as a smooth
// brown → green → yellow column. With 16 visible rows and only
// 13 stops in the palette, we deliberately STRETCH the green
// band (s4..s9, six stops) across the operational + compliance
// rows so the bulk of the menu reads as the brand's signature
// green, and compress the yellow tail (s10..s13) into the
// admin block.
const C = {
  s1: BRAND_GRADIENT[0], // dashboard            (espresso brown)
  s2: BRAND_GRADIENT[1], // farmers              (cocoa)
  s3: BRAND_GRADIENT[2], // farms                (sienna)
  s4: BRAND_GRADIENT[3], // training             (deep forest — green start)
  s5: BRAND_GRADIENT[4], // coaching             (forest)
  s6: BRAND_GRADIENT[5], // society purchase     (olive)
  s7: BRAND_GRADIENT[6], // primary evac         (apple)
  s8: BRAND_GRADIENT[7], // secondary evac       (sprout)
  s9: BRAND_GRADIENT[8], // inspections          (light green)
  s10: BRAND_GRADIENT[9], // reports + coops      (lime — yellow start)
  s11: BRAND_GRADIENT[10], // users               (mustard)
  s12: BRAND_GRADIENT[11], // roles + permissions (golden yellow)
  s13: BRAND_GRADIENT[12], // sync                (warm yellow tail)
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
        iconColor: C.s1,
        permission: 'dashboard:read',
      },
      {
        labelKey: 'navigation.farmers',
        href: '/farmers',
        icon: Users,
        iconColor: C.s2,
        permission: 'farmer:read',
      },
      {
        labelKey: 'navigation.farms',
        href: '/farms',
        icon: LandPlot,
        iconColor: C.s3,
        permission: 'parcel:read',
      },
      {
        // The compliance picture in one screen — every plot, coloured by
        // EUDR status, over the deforestation zones. Its own entry because
        // it is the view a buyer asks for, not a sub-tab of the plot list.
        labelKey: 'farmMap.title',
        href: '/farms/map',
        icon: Map,
        iconColor: C.s3,
        permission: 'parcel:read',
      },
      {
        labelKey: 'navigation.vsla',
        href: '/vsla',
        icon: PiggyBank,
        iconColor: C.s3,
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
        iconColor: C.s4,
        permission: 'training:read',
      },
      {
        labelKey: 'navigation.coaching',
        href: '/coaching',
        icon: Handshake,
        iconColor: C.s5,
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
        iconColor: C.s6,
        permission: 'purchase:read',
      },
      {
        labelKey: 'navigation.primaryEvac',
        href: '/primary-evacuation',
        icon: Truck,
        iconColor: C.s7,
        permission: 'primary_evac:read',
      },
      {
        labelKey: 'navigation.secondaryEvac',
        href: '/secondary-evacuation',
        icon: TruckLeft,
        iconColor: C.s8,
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
        iconColor: C.s9,
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
        iconColor: C.s9,
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
        iconColor: C.s10,
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
        iconColor: C.s10,
        permission: 'cooperative:read',
      },
      {
        labelKey: 'navigation.adminUsers',
        href: '/admin/users',
        icon: UserCog,
        iconColor: C.s11,
        permission: 'user:read',
      },
      {
        labelKey: 'navigation.adminRoles',
        href: '/admin/roles',
        icon: Shield,
        iconColor: C.s12,
        permission: 'role:read',
      },
      {
        labelKey: 'navigation.adminPermissions',
        href: '/admin/permissions',
        icon: KeyRound,
        iconColor: C.s12,
        permission: 'permission:read',
      },
      {
        labelKey: 'navigation.adminSync',
        href: '/admin/sync',
        icon: RefreshCw,
        iconColor: C.s13,
        permission: 'sync:config',
      },
    ],
  },
];
