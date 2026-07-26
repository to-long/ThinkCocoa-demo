/**
 * Standardised status pill — the ONE place bg/border/text tones for
 * every "state" label live. Use this instead of hand-rolling
 * `bg-{color}-{n}` combinations in feature files.
 *
 * Design contract (matches the inspection-detail chip style):
 *   - Rounded-full border pill
 *   - Bordered variant: `bg-{tone}-100 border-{tone}-300 text-{tone}-800`
 *   - `text-[11px] font-semibold`, 2px vertical + 8px horizontal padding
 *   - Optional leading dot (turned on via `dot` prop) for tighter chips
 *   - Optional trailing count (bold) for stat pills
 *
 * Tone semantics (semantic, not visual — pick by meaning):
 *   - `success`   — final positive state (Active, Certified, Consented,
 *                    EUDR compliant, "audit passed")
 *   - `warning`   — soft caution, still passable (Not Certified,
 *                    "needs follow-up")
 *   - `caution`   — mid-severity flag between success + danger (EUDR
 *                    Needs review, amber alarms)
 *   - `danger`    — hard fail (Disqualified, Inactive/Blocked, EUDR
 *                    non-compliant)
 *   - `info`      — informational / status label (blue) — VD Submitted
 *                    receipt, "In progress", "Draft"
 *   - `info2`     — sequence / cohort highlight (violet) — VD program
 *                    year, tenure bucket, "Year 5+"
 *   - `lime`      — light-green source / origin marker (lime) — VD
 *                    Society, farmer village, upstream cooperative node
 *   - `neutral`   — no signal (Deleted, No data, Declined, "—")
 *
 * When adding a new tone: add the palette here AND a comment on the
 * enum value about when it applies. Do NOT invent bespoke colours in
 * feature files — extend this instead so the whole app stays legible.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone =
  | 'success'
  | 'warning'
  | 'caution'
  | 'danger'
  | 'info'
  | 'info2'
  | 'lime'
  | 'neutral';

interface Palette {
  /** Solid pill bg (small-pill variant) */
  bg: string;
  /** Border colour — visible on both variants */
  border: string;
  /** Foreground text colour on the small-pill variant */
  text: string;
  /** Leading-dot colour (only rendered when `dot` prop is true). */
  dot: string;
  /** Lighter bg for the medium icon-holder variant. */
  bgSoft: string;
  /** Deeper text colour paired with `bgSoft` on the medium variant. */
  textSoft: string;
  /** Softer border for the medium icon-holder variant (lighter than
   *  the small pill's border to sit nicer with the soft bg). */
  borderSoft: string;
}

const TONES: Record<StatusTone, Palette> = {
  success: {
    bg: 'bg-green-100',
    border: 'border-green-300',
    text: 'text-green-800',
    dot: 'bg-green-600',
    bgSoft: 'bg-green-50',
    textSoft: 'text-green-700',
    borderSoft: 'border-green-200',
  },
  warning: {
    bg: 'bg-orange-100',
    border: 'border-orange-300',
    text: 'text-orange-800',
    dot: 'bg-orange-600',
    bgSoft: 'bg-orange-50',
    textSoft: 'text-orange-700',
    borderSoft: 'border-orange-200',
  },
  caution: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    bgSoft: 'bg-amber-50',
    textSoft: 'text-amber-700',
    borderSoft: 'border-amber-200',
  },
  danger: {
    bg: 'bg-red-100',
    border: 'border-red-300',
    text: 'text-red-800',
    dot: 'bg-red-600',
    bgSoft: 'bg-red-50',
    textSoft: 'text-red-700',
    borderSoft: 'border-red-200',
  },
  info: {
    bg: 'bg-blue-100',
    border: 'border-blue-300',
    text: 'text-blue-800',
    dot: 'bg-blue-600',
    bgSoft: 'bg-sky-50',
    textSoft: 'text-sky-700',
    borderSoft: 'border-sky-200',
  },
  info2: {
    bg: 'bg-violet-100',
    border: 'border-violet-300',
    text: 'text-violet-800',
    dot: 'bg-violet-600',
    bgSoft: 'bg-violet-50',
    textSoft: 'text-violet-700',
    borderSoft: 'border-violet-200',
  },
  lime: {
    bg: 'bg-lime-100',
    border: 'border-lime-300',
    text: 'text-lime-800',
    dot: 'bg-lime-600',
    bgSoft: 'bg-lime-50',
    textSoft: 'text-lime-700',
    borderSoft: 'border-lime-200',
  },
  neutral: {
    bg: 'bg-gray-100',
    border: 'border-gray-300',
    text: 'text-gray-700',
    dot: 'bg-gray-500',
    bgSoft: 'bg-gray-50',
    textSoft: 'text-gray-600',
    borderSoft: 'border-gray-200',
  },
};

interface StatusTagProps {
  tone: StatusTone;
  children: ReactNode;
  /** Optional trailing number — renders bolder next to the label.
   *  Used by breakdown pills on stats cards. Only respected on the
   *  `status` variant. */
  count?: number;
  /** Prefix a small filled circle before the label. Off by default;
   *  turn on for high-density chips where the pill's own colour is
   *  the only distinguishing feature. `status` variant only. */
  dot?: boolean;
  /** Purpose-based variant:
   *  - `status` (default): rounded-full text pill with border +
   *    count/dot modifiers. State labels next to values (Certified,
   *    Active, Compliant…).
   *  - `icon`: square 36×36 icon holder — softer bg + border,
   *    rounded-md. Marks the tile's category at the top of stat
   *    cards (Training / Coaching / Farmers). Pass the icon as
   *    `children`; `count` + `dot` are ignored. */
  variant?: 'status' | 'icon';
  className?: string;
}

export function StatusTag({
  tone,
  children,
  count,
  dot = false,
  variant = 'status',
  className,
}: StatusTagProps) {
  const p = TONES[tone];
  if (variant === 'icon') {
    return (
      <span
        aria-hidden={true}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
          p.bgSoft,
          p.textSoft,
          p.borderSoft,
          className,
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      // `w-fit` keeps the pill from stretching to the container's
      // cross-axis width when it's a direct child of a `flex
      // flex-col`. `self-start` would force top-alignment which
      // breaks parents that centre vertically (VD CardHeader
      // action row) — width-only fix is enough.
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight whitespace-nowrap',
        p.bg,
        p.border,
        p.text,
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', p.dot)} />}
      {/* Inline-flex so a caller that passes `<Icon /> text` renders
       *  icon + label as one row instead of the SVG dropping below
       *  the text in narrow containers. `min-w-0` lets a `truncate`
       *  child actually shrink — without it a long label (VD a full
       *  cooperative name) overflows a `max-w-*` pill instead of
       *  ellipsising. */}
      <span className="inline-flex min-w-0 items-center gap-1">{children}</span>
      {count != null && <span className="font-bold tabular-nums">{count}</span>}
    </span>
  );
}
