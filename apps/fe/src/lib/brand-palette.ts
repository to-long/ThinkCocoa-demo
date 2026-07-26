/**
 * ImpactCocoa brand palette — single source of truth for the design
 * tokens sourced from Pencil node `STuuC`. Reading the gradient
 * top→bottom flows espresso → cocoa → sienna → olive → leaf → lime
 * → golden yellow.
 *
 * Use cases (and the stops each one consumes):
 *   - Sidebar menu icons       → all 13 stops, one per row.
 *   - Notification preferences → stops 2..13 (12 resources, no
 *     Dashboard analogue).
 *   - Avatar tints             → stops 1..8 (the dark half, so
 *     overlay white text stays legible).
 *
 * Whenever a new surface needs a brand-tinted accent, prefer a stop
 * from this file over a fresh hex — it keeps the FE visually
 * coherent and lets a future palette refresh land in one place.
 */
export const BRAND_GRADIENT = [
  '#3A2410', // s1  — espresso
  '#7B3F00', // s2  — cocoa
  '#A0522D', // s3  — sienna
  '#3D5A1D', // s4  — deep forest
  '#4A7A22', // s5  — forest
  '#5A8A2A', // s6  — olive
  '#5CA832', // s7  — apple green
  '#4CAF50', // s8  — sprout (last stop white-text-safe)
  '#8BC34A', // s9  — light green
  '#CDDC39', // s10 — lime
  '#E8D32A', // s11 — mustard
  '#F5C518', // s12 — golden yellow
  '#FFD54F', // s13 — warm yellow
] as const;

export type BrandStop = (typeof BRAND_GRADIENT)[number];

/**
 * White-text-safe subset: the eight darkest stops. Used by the
 * notification avatar (`<NotificationMenuItem>`) and the audit-log
 * detail page header — both render bold white initials on a 28–32 px
 * circle, which needs a low-luminance background to pass WCAG AA at
 * that font size. Stops 9..13 (light greens, yellows) wash out the
 * initials and are deliberately excluded.
 */
export const AVATAR_PALETTE = BRAND_GRADIENT.slice(0, 8);

/**
 * Resource-to-tint map mirroring the sidebar menu order in
 * `app-sidebar/menu-settings.ts`. The first stop (espresso) is
 * reserved for Dashboard — which has no notification analogue — so
 * resources start at stop 2. Used by:
 *   - `notification-preferences-form.tsx` (per-resource toggles)
 *   - any future surface that wants to colour a resource icon
 *     consistently with the sidebar.
 */
export const RESOURCE_TINT: Record<string, BrandStop> = {
  farmer: BRAND_GRADIENT[1], // s2
  parcel: BRAND_GRADIENT[2], // s3
  batch: BRAND_GRADIENT[3], // s4
  training: BRAND_GRADIENT[4], // s5
  eudr: BRAND_GRADIENT[5], // s6
  inspection: BRAND_GRADIENT[6], // s7
  report: BRAND_GRADIENT[7], // s8
  cooperative: BRAND_GRADIENT[8], // s9
  user: BRAND_GRADIENT[9], // s10
  role: BRAND_GRADIENT[10], // s11
  permission: BRAND_GRADIENT[11], // s12
  sync: BRAND_GRADIENT[12], // s13
};

/**
 * Deterministic stop picker for free-form names (notification
 * actor avatars). Same input → same colour, every render. Uses
 * Java's `String.hashCode()` rule (`hash * 31 + charCode`) so two
 * users with adjacent names rarely collide on the same stop.
 */
export function avatarTintForName(name: string): BrandStop {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

// ── HSL helpers for theme-adaptive tints ───────────────────────────
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '');
  const r = Number.parseInt(m.slice(0, 2), 16) / 255;
  const g = Number.parseInt(m.slice(2, 4), 16) / 255;
  const b = Number.parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + mm) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Adapt a brand-gradient stop for the active theme. In light mode the
 * spec'd hex is returned unchanged. In dark mode the darkest stops
 * (espresso, cocoa, sienna, forest greens) are near-invisible on the
 * dark sidebar, so we raise the lightness to a floor while keeping the
 * hue — the icon stays recognisably brand-tinted but readable.
 */
export function brandTintForTheme(hex: string, isDark: boolean): string {
  if (!isDark) return hex;
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(s, 0.7), Math.max(l, 0.62));
}
