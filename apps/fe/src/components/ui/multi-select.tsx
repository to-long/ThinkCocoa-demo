/**
 * Shadcn-style multi-select built from the existing Popover + Checkbox
 * primitives. Mirrors the `Select` trigger look so the two can sit in the
 * same filter bar without visual drift.
 *
 * Usage:
 *   <MultiSelect
 *     values={selected}
 *     onChange={setSelected}
 *     options={[{ value: "active", label: "Active" }, ...]}
 *     placeholder="All statuses"
 *     className="w-[180px]"
 *   />
 *
 * Semantics:
 *   - `values` is the source of truth; component is controlled.
 *   - Clicking a row toggles its value (and-of is the caller's concern).
 *   - Trigger label: placeholder (no selection) / label (one) / "N selected"
 *     (many) — keeps the bar compact without hiding state entirely.
 */

import { ChevronDownIcon, X } from 'lucide-react';
import type * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: React.ReactNode;
  /** Optional short string used in the collapsed trigger label. Falls back to
   *  `String(label)` if the label is already a string. */
  shortLabel?: string;
}

interface MultiSelectProps {
  values: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  placeholder: string;
  className?: string;
  /** Clamp the number of chip labels rendered inside the trigger before
   *  collapsing into "N selected". Defaults to 1 — matches the Select
   *  primitive's single-line trigger. */
  maxChips?: number;
  /** Label for the "clear all" affordance inside the popover. */
  clearLabel?: string;
}

export function MultiSelect({
  values,
  onChange,
  options,
  placeholder,
  className,
  maxChips = 1,
  clearLabel = 'Clear',
}: MultiSelectProps) {
  const selectedOptions = options.filter((o) => values.includes(o.value));

  const triggerContent = (() => {
    // Always wrap in `min-w-0 flex-1 truncate` so a long placeholder /
    // selected-label gets ellipsised instead of overflowing past the
    // button border into adjacent siblings (e.g. French translations
    // of "Toutes les certifications" used to bleed onto the Reset link).
    if (selectedOptions.length === 0) {
      return (
        <span
          className="min-w-0 flex-1 truncate text-left text-muted-foreground"
          title={placeholder}
        >
          {placeholder}
        </span>
      );
    }
    if (selectedOptions.length <= maxChips) {
      const text = selectedOptions
        .map((o) => o.shortLabel ?? (typeof o.label === 'string' ? o.label : o.value))
        .join(', ');
      return (
        <span className="min-w-0 flex-1 truncate text-left text-foreground" title={text}>
          {text}
        </span>
      );
    }
    return (
      <span className="min-w-0 flex-1 truncate text-left text-foreground">
        {selectedOptions.length} selected
      </span>
    );
  })();

  const toggle = (value: string) => {
    if (values.includes(value)) onChange(values.filter((v) => v !== value));
    else onChange([...values, value]);
  };

  const clearAll = () => onChange([]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // Match SelectTrigger's base styling so the two components line up
            // pixel-perfect in the filter bar.
            'flex h-9 w-fit select-none items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50',
            className,
          )}
        >
          {triggerContent}
          <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[200px] p-1">
        <div className="flex flex-col">
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left transition-colors hover:bg-accent"
              >
                <Checkbox
                  checked={checked}
                  // Delegate the toggle to the row's click handler — we stop
                  // propagation so Radix's root click + the checkbox's own
                  // change don't fire the callback twice.
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={() => toggle(opt.value)}
                />
                <span className="flex-1">{opt.label}</span>
              </button>
            );
          })}
          {values.length > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="size-3.5" />
                <span>{clearLabel}</span>
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
