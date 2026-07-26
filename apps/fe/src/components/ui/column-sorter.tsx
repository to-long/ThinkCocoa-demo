/**
 * Click-to-sort column header used inside `<TableHead>`.
 *
 * The component is "controlled": the parent owns the canonical sort
 * value (typically backed by URL search params) and renders this
 * button to expose the 3-state click cycle:
 *
 *     null  →  desc  →  asc  →  null  →  …
 *
 * Each click computes the next value and calls `onChange(next)`. The
 * parent decides what to do with it — write to URL, mirror to React
 * state, fire an SWR refetch, etc. The component itself holds no
 * state, so two sorters on the same page can never disagree about
 * what's currently active.
 *
 * Visual design:
 *   • asc  → light green  arrow-up       ("smaller / earlier first")
 *   • desc → light indigo arrow-down     ("larger / latest first")
 *   • null → light grey   arrow-up-down  (no explicit sort)
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortValue = 'asc' | 'desc' | null;

interface ColumnSorterProps {
  /** Current sort state. `null` means "no explicit sort applied". */
  value: SortValue;
  /** Called with the NEXT state on each click — parent writes to URL. */
  onChange: (next: SortValue) => void;
  /** Visible column header text. */
  label: string;
  /** Optional override for the button's accessible name; falls back
   *  to `label` if not provided. */
  ariaLabel?: string;
  /** Extra classes for the button (e.g. layout adjustments inside
   *  custom `<TableHead>` paddings). */
  className?: string;
}

/** Compute the next state in the asc/desc/null cycle. Exported so
 *  callers / tests can reuse the rule without re-deriving it. */
export function nextSortValue(current: SortValue): SortValue {
  if (current === null) return 'desc';
  if (current === 'desc') return 'asc';
  return null;
}

export function ColumnSorter({ value, onChange, label, ariaLabel, className }: ColumnSorterProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(nextSortValue(value))}
      className={cn(
        'flex h-full w-full items-center gap-1.5 px-2 py-2 text-left font-medium hover:text-foreground cursor-pointer',
        className,
      )}
      aria-label={ariaLabel ?? label}
      aria-sort={value === 'asc' ? 'ascending' : value === 'desc' ? 'descending' : 'none'}
    >
      {/* `min-w-0 truncate` lets a long header shrink instead of pushing
          the arrow out of a narrow fixed-width cell (where it would be
          clipped); the icon is `shrink-0` so it always stays visible. */}
      <span className="min-w-0 truncate">{label}</span>
      {value === 'asc' ? (
        <ArrowUp className="size-3.5 shrink-0 text-green-500" />
      ) : value === 'desc' ? (
        <ArrowDown className="size-3.5 shrink-0 text-indigo-400" />
      ) : (
        <ArrowUpDown className="size-3.5 shrink-0 text-gray-300" />
      )}
    </button>
  );
}
