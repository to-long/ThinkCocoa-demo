/**
 * Shared link styles for list tables.
 *
 * Two roles, one look each — so a code/date link reads the same on every
 * list screen instead of drifting per feature:
 *
 *   - `LIST_SUB_LINK` — the secondary line inside a cell (farmer code
 *     under a name, DOB under a child, visit date under a coach…).
 *     Muted by default, foreground + underline on hover, `gap-1` so the
 *     trailing open-in icon breathes.
 *   - `LIST_ID_LINK` — a cell whose whole value IS the identifier link
 *     (waybill #, purchase ID). Foreground-coloured: it's the row's
 *     primary label, so it should read like body text, with the
 *     underline-on-hover carrying the affordance. (It used to be
 *     `text-primary`, which turned every ID column blue once the brand
 *     colour moved off near-black.)
 */

export const LIST_SUB_LINK =
  'inline-flex w-fit items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline';

export const LIST_ID_LINK =
  'inline-flex w-fit items-center gap-1 font-mono font-medium text-foreground text-xs hover:underline';
