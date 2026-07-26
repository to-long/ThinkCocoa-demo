/**
 * URL-backed multi-column table sort, shared by every list screen.
 *
 * The sort state lives in the `sort` search param as a JSON:API-style,
 * comma-separated, ORDERED list of tokens — position = priority (first
 * clicked is the primary sort, the next is the tiebreaker, etc):
 *
 *     ?sort=-society            → society desc
 *     ?sort=-society,name       → society desc, then name asc
 *     (absent)                  → no explicit sort (BE default order)
 *
 * `sorterPropsFor(field)` returns the `{ value, onChange }` pair a
 * `<ColumnSorter>` expects. Each header reads ONLY its own entry, so
 * the other columns keep their arrows. Clicking cycles that one column
 * through desc → asc → null:
 *   - null → desc: APPEND `{field, desc}` (lowest priority).
 *   - desc → asc:  flip direction in place (keeps its priority).
 *   - asc  → null: REMOVE the field; survivors keep their order.
 *
 * `sort` is the encoded string forwarded to the API (BE `buildOrderBy`
 * whitelists + orders by each token). `sortSpec` is the parsed ordered
 * list for client-side screens that sort in memory. `hasSort` lets a
 * page show its reset control whenever any sort is active — resetting
 * should clear `sort` along with the filters.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortValue } from '@/components/ui/column-sorter';

export interface SortEntry {
  field: string;
  dir: 'asc' | 'desc';
}

interface UseTableSortResult {
  /** Encoded token(s) for the API call, or `undefined` when unsorted. */
  sort: string | undefined;
  /** `true` when any column is actively sorted. */
  hasSort: boolean;
  /** Parsed, priority-ordered sort spec (for client-side sorting). */
  sortSpec: SortEntry[];
  /** Props for a `<ColumnSorter>` bound to `field`. */
  sorterPropsFor: (field: string) => {
    value: SortValue;
    onChange: (next: SortValue) => void;
  };
}

function parseSort(raw: string): SortEntry[] {
  return raw
    .split(',')
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => {
      const isDesc = tok.startsWith('-');
      return { field: isDesc ? tok.slice(1) : tok, dir: isDesc ? 'desc' : 'asc' } as SortEntry;
    });
}

function encodeSort(spec: SortEntry[]): string {
  return spec.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',');
}

export function useTableSort(): UseTableSortResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('sort') ?? '';
  const sortSpec = useMemo(() => parseSort(raw), [raw]);

  const sorterPropsFor = useCallback(
    (field: string) => {
      const entry = sortSpec.find((s) => s.field === field) ?? null;
      return {
        value: (entry?.dir ?? null) as SortValue,
        onChange: (next: SortValue) => {
          const idx = sortSpec.findIndex((s) => s.field === field);
          let nextSpec = [...sortSpec];
          if (next === null) {
            nextSpec = nextSpec.filter((s) => s.field !== field);
          } else if (idx >= 0) {
            nextSpec[idx] = { field, dir: next };
          } else {
            nextSpec.push({ field, dir: next });
          }
          const encoded = encodeSort(nextSpec);
          setSearchParams(
            (prev) => {
              const out = new URLSearchParams(prev);
              if (encoded) out.set('sort', encoded);
              else out.delete('sort');
              // A new sort order invalidates the current page offset.
              out.delete('page');
              return out;
            },
            { replace: true },
          );
        },
      };
    },
    [sortSpec, setSearchParams],
  );

  return {
    sort: raw || undefined,
    hasSort: sortSpec.length > 0,
    sortSpec,
    sorterPropsFor,
  };
}
