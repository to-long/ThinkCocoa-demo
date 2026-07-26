---
name: fe-list-page
description: ImpactCocoa FE convention for any admin list page (users, farmers, cooperatives, roles, permissions, audit). Use when adding a new list page, refactoring an existing one, or reviewing one. Codifies the four mandatory pillars — stats cards, URL-backed pagination, multi-column sort, multi-select filters — plus the SWR + URL state pattern.
---

# FE list page — the four pillars

Every admin list page in this repo must ship **all four** of: stats cards, pagination, sort, filter. Every piece of UI state that affects the query goes into the URL — back button must work, deep links must work, refresh must work.

Reference page: `apps/fe/src/features/admin/components/users/users-page-content.tsx`. Mirror it.

## Page layout (top → bottom)

1. **Page header** — title + subtitle + primary action (e.g. "Add User")
2. **Error banner** — `pageError` / `listError` (dismissible)
3. **Stats cards** — 3-4 slim cards, fed by `use<Feature>Stats()` SWR hook
4. **Filter bar** — search input + multi-select dropdowns + reset link
5. **Table** — sortable columns via `ColumnSorter`, action icons in last col
6. **Pagination** — `<DataPagination>` shared component, never custom

## Pillar 1 — URL-backed pagination

Use `useSearchParams` from react-router. **NEVER** call `setSearchParams` multiple times in a row — react-router reads the ref at call time, so the second call stomps the first.

```ts
// Single batched setter — the ONLY shape that works.
const updateUrl = useCallback((updates: Record<string, string | null>) => {
  const next = new URLSearchParams(searchParamsRef.current);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === '') next.delete(k);
    else next.set(k, v);
  }
  setSearchParams(next, { replace: true });
}, [setSearchParams]);

// Filter onChange must batch — page reset + filter set in ONE call:
onChange={(values) => updateUrl({ status: values.join(','), page: null })}
```

Default `pageSize=20`. Match the BE clamp (max 100).

## Pillar 2 — Stats cards

```tsx
const { data: stats } = useFarmerStats();   // SWR keyed on /api/farmers/stats
<StatsCardsRow>
  <StatCard label="Total" value={stats?.total} />
  <StatCard label="Active" value={stats?.byStatus.active} />
  ...
</StatsCardsRow>
```

- Slim cards (single value + label). No charts here.
- Dim with `style={{ opacity: refetching ? 0.85 : 1 }}` during refetch (NOT Tailwind arbitrary `opacity-[0.85]` — doesn't resolve).
- Reuses BE's `X-Cache` header semantics; no FE caching layer.

## Pillar 3 — Multi-column sort

Use the shared `<ColumnSorter>` component (`apps/fe/src/components/ui/column-sorter.tsx`).

```tsx
<TableHead>
  <ColumnSorter {...sorterPropsFor('createdAt')}>Created</ColumnSorter>
</TableHead>
```

`sorterPropsFor(field)` is a per-page helper that:
- Reads current `sort` URL param, finds this field's position + direction
- Returns `{ direction: 'asc' | 'desc' | null, priority: 1-N | null, onClick }`
- onClick cycles `null → desc → asc → null`, preserves OTHER columns (multi-field tiebreakers)
- Calls `updateUrl({ sort: nextSpec, page: null })`

Tri-state icons:
- `null` → `ArrowUpDown` grey (default — no explicit sort)
- `asc`  → `ArrowUp`     **green** ("smaller / earlier first")
- `desc` → `ArrowDown`   **red**   ("larger / latest first")

Spec format matches BE: comma-separated, `-` prefix for desc → `?sort=-createdAt,name`.

## Pillar 4 — Multi-select filters

```tsx
const statuses = parseCsv(searchParams.get('status'));  // ["active","inactive"]
<MultiSelect
  values={statuses}
  options={[{ value: 'active', label: 'Active' }, ...]}
  onChange={(next) => updateUrl({ status: next.join(',') || null, page: null })}
/>
```

- `parseCsv(raw)` helper splits + trims + filters empty.
- Empty selection → set null (drops from URL, BE applies no filter).
- Reset link clears all filters + page in one `updateUrl({...})` call.

Search input:
- Local mirror of URL param (so typing is responsive)
- 300ms debounce → `updateUrl({ q: debounced || null, page: null })`
- `useDebounce` from `apps/fe/src/shared/hooks/`

## Pillar 5 (bonus) — Shared pagination

Always use `<DataPagination>` (`apps/fe/src/components/ui/data-pagination.tsx`). Never roll your own — the cooperatives page once had custom client-side pagination and that's how we ended up with the "no BE pagination" bug.

```tsx
<DataPagination
  page={page}
  pageSize={pageSize}
  total={total}
  onPageChange={(p) => updateUrl({ page: String(p) })}
/>
```

## SWR hook conventions

`apps/fe/src/shared/api/<feature>.ts` exposes:

```ts
useFeatureList(params)         // SWR-keyed on params, returns { data, total, page, pageSize }
useFeatureStats()              // SWR-keyed on /api/.../stats
useFeature(id)                 // detail
createFeature(input)           // mutation
updateFeature(id, patch)       // mutation
softDeleteFeature(id)          // mutation
restoreFeature(id)             // mutation (where applicable)
```

Mutations call `globalMutate(matchFeatureList)` after server confirms — list + detail caches stay in sync without page refresh.

## Action column

- Icon-only buttons (Eye, Pencil, Trash, RotateCcw)
- ALL action buttons must have `cursor-pointer` (Tailwind class; not free with shadcn buttons)
- Soft-deleted rows: hide Pencil/Trash, show RotateCcw (Restore)
- Status badge in its own column (NOT smashed into the name) with "Deleted" bucket muted

## Status codes the FE handles

- `400` — show error toast with response body's `error` string (e.g. "No fields to update")
- `404` — show "not found" toast, navigate back to list
- `409` — show conflict toast (duplicate code/email)
- `5xx` — generic "Something went wrong" toast + log to console

## Verification before committing

```bash
cd apps/fe && bun run build   # rsbuild + tsc
```

If FE talks to a new BE endpoint, regenerate the SDK first:
```bash
bun run impact-cocoa-client:refresh
```

## Reference files (read before writing new pages)

- Canonical: `apps/fe/src/features/admin/components/users/users-page-content.tsx`
- ColumnSorter: `apps/fe/src/components/ui/column-sorter.tsx`
- DataPagination: `apps/fe/src/components/ui/data-pagination.tsx`
- Detail page pattern: `apps/fe/src/features/admin/components/users/user-detail-page-content.tsx`
- SWR hooks pattern: `apps/fe/src/shared/api/users.ts`
