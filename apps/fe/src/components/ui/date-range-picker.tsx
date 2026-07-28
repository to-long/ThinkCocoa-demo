import { format } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type DateRangeValue = { from?: Date; to?: Date };

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  placeholder?: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
  numberOfMonths?: number;
  /** Filter which preset buttons appear on the left sidebar. Default =
   *  every preset. `"seasons"` restricts to the 5 cocoa-year presets
   *  (`Season 2025/26`, …) — used by the Reports page where the range
   *  is always a season boundary. */
  presets?: 'all' | 'seasons';
}

interface Preset {
  key: string;
  label: string;
  compute: () => DateRangeValue;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date | undefined, b: Date | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(d: Date): Date {
  // Monday-start week.
  const r = startOfDay(d);
  const dow = r.getDay();
  const diff = (dow + 6) % 7;
  r.setDate(r.getDate() - diff);
  return r;
}

const PRESETS: Preset[] = [
  {
    key: 'today',
    label: 'Today',
    compute: () => {
      const today = startOfDay(new Date());
      return { from: today, to: today };
    },
  },
  {
    key: 'last7d',
    label: 'Last 7 days',
    compute: () => {
      const today = startOfDay(new Date());
      return { from: addDays(today, -6), to: today };
    },
  },
  {
    key: 'last30d',
    label: 'Last 30 days',
    compute: () => {
      const today = startOfDay(new Date());
      return { from: addDays(today, -29), to: today };
    },
  },
  {
    key: 'lastWeek',
    label: 'Last week',
    compute: () => {
      const thisWeekStart = startOfWeek(new Date());
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      return { from: lastWeekStart, to: lastWeekEnd };
    },
  },
  {
    key: 'lastMonth',
    label: 'Last month',
    compute: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from, to };
    },
  },
  // Cocoa seasons — Oct 1 → Sep 30. Emit the current season plus the
  // 4 before it, labelled by the `YYYY/YY` code (e.g. `2025/26`) so the
  // dropdown reads the same way admins already select seasons on the
  // /reports page.
  ...(() => {
    const now = new Date();
    const y = now.getFullYear();
    const currentStart = now.getMonth() >= 9 ? y : y - 1;
    return Array.from({ length: 5 }, (_, i) => {
      const startYear = currentStart - i;
      const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
      const label = i === 0 ? 'This season' : `Season ${startYear}/${endYearShort}`;
      return {
        key: `season-${startYear}`,
        label,
        compute: () => ({
          from: new Date(startYear, 9, 1),
          to: new Date(startYear + 1, 8, 30),
        }),
      };
    });
  })(),
];

export function DateRangePicker({
  value,
  onChange,
  placeholder = 'Pick a date range',
  className,
  align = 'start',
  numberOfMonths = 2,
  presets = 'all',
}: DateRangePickerProps) {
  const visiblePresets = React.useMemo(
    () => (presets === 'seasons' ? PRESETS.filter((p) => p.key.startsWith('season-')) : PRESETS),
    [presets],
  );
  // Local "draft" range: tracks the in-progress selection (first click only).
  // We commit to the parent (`onChange`) only when both from + to are set —
  // so the upstream query/URL doesn't fire while the user is mid-selection,
  // and the next selection naturally restarts from a fresh start date.
  const [draft, setDraft] = React.useState<DateRangeValue>(value);

  // Sync draft when the parent value actually changes (compare timestamps,
  // not object identity — the parent re-creates the {from,to} literal each
  // render which would otherwise stomp the in-progress draft on every keypress).
  const fromTs = value.from?.getTime();
  const toTs = value.to?.getTime();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timestamps ARE the comparison the note above describes — depending on the Date objects themselves re-runs every render and stomps the draft mid-edit
  React.useEffect(() => {
    setDraft({ from: value.from, to: value.to });
  }, [fromTs, toTs]);

  const selected: DateRange | undefined =
    draft.from || draft.to ? { from: draft.from, to: draft.to } : undefined;

  const [viewMonth, setViewMonth] = React.useState<Date>(value.from ?? new Date());

  const label = React.useMemo(() => {
    const { from, to } = value;
    if (from && to) return `${format(from, 'dd/MM/yy')} - ${format(to, 'dd/MM/yy')}`;
    if (from) return format(from, 'dd/MM/yy');
    return null;
  }, [value]);

  const applyPreset = (p: Preset) => {
    const range = p.compute();
    if (range.from) setViewMonth(range.from);
    setDraft(range);
    onChange(range);
  };

  const handleSelect = (range: DateRange | undefined) => {
    const next: DateRangeValue = (() => {
      if (!range) return { from: undefined, to: undefined };

      const hadStart = Boolean(draft.from);
      const hadFullRange = Boolean(draft.from && draft.to);

      // After a full range is already committed, react-day-picker extends or
      // shifts it instead of starting fresh. Detect the actual date the user
      // just clicked and restart the selection from there.
      if (hadFullRange) {
        const clicked =
          range.from && !sameDay(range.from, draft.from) && !sameDay(range.from, draft.to)
            ? range.from
            : range.to && !sameDay(range.to, draft.from) && !sameDay(range.to, draft.to)
              ? range.to
              : (range.from ?? undefined);
        return { from: clicked, to: undefined };
      }

      // First click on an empty selection: rdp returns {from: X, to: X} (a
      // 1-day range) when min=0. Treat that as just the start so the next
      // click can pick the end.
      if (!hadStart) {
        return { from: range.from ?? undefined, to: undefined };
      }

      // Second click — committing the end (same-day click commits a 1-day range).
      return { from: range.from ?? undefined, to: range.to ?? undefined };
    })();
    setDraft(next);
    if (next.from && next.to) onChange(next);
  };

  const hasValue = Boolean(value.from || value.to);

  return (
    <div className={cn('w-full', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              'relative h-9 w-full justify-start gap-1.5 pr-7 pl-2.5 text-left font-normal text-sm',
              !label && 'text-muted-foreground hover:text-muted-foreground',
            )}
          >
            <CalendarIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{label ?? placeholder}</span>
            {hasValue && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear date range"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange({ from: undefined, to: undefined });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange({ from: undefined, to: undefined });
                  }
                }}
                className="-translate-y-1/2 absolute top-1/2 right-1.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <div className="flex">
            <div className="flex max-h-[240px] w-[150px] flex-col gap-0.5 overflow-y-auto border-r p-2 [&>button]:whitespace-nowrap">
              {visiblePresets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="cursor-pointer rounded px-2 py-1.5 text-left text-xs hover:bg-foreground hover:text-background"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Calendar
              mode="range"
              month={viewMonth}
              onMonthChange={setViewMonth}
              selected={selected}
              onSelect={handleSelect}
              numberOfMonths={numberOfMonths}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
