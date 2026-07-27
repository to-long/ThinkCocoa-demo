/**
 * Two-line timestamp cell used in list tables: wall-clock (HH:mm:ss) on
 * top, date (dd-MM-yyyy) underneath in a smaller, muted font. Both lines
 * are pinned to Ghana's timezone. Renders a muted placeholder when the
 * value is null/invalid.
 */

import { formatGhanaClock, formatGhanaDateDMY } from '@/lib/datetime';

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
    <span className="flex flex-col leading-tight">
      <span className="font-semibold text-foreground tabular-nums">{formatGhanaClock(value)}</span>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {formatGhanaDateDMY(value)}
      </span>
    </span>
  );
}
