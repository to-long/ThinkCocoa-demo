/**
 * Two-line timestamp cell used in list tables: wall-clock (HH:mm:ss) on
 * top, date (dd-MM-yyyy) underneath in a smaller, muted font. Both lines
 * are pinned to Ghana's timezone. Renders a muted placeholder when the
 * value is null/invalid.
 *
 * Built on `RefCell` so a timestamp column stacks exactly like every other
 * two-line cell (name over code) instead of being its own near-miss.
 * `tabular-nums` on both lines keeps the digits column-aligned down the
 * table.
 */

import { formatGhanaClock, formatGhanaDateDMY } from '@/lib/datetime';
import { RefCell } from './entity-ref-cell';

export function StackedDateTime({
  value,
  placeholder = '—',
}: {
  value: string | number | Date | null | undefined;
  placeholder?: string;
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }
  return (
    <RefCell
      name={<span className="tabular-nums">{formatGhanaClock(value)}</span>}
      code={<span className="tabular-nums">{formatGhanaDateDMY(value)}</span>}
    />
  );
}
