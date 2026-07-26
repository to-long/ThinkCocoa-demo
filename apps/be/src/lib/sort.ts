/**
 * Shared sort parsing for list endpoints.
 *
 * The FE encodes table sort state as a JSON:API-style string in the
 * `sort` query param:
 *
 *     ?sort=name            → order by `name` ascending
 *     ?sort=-purchase_date  → order by `purchase_date` descending
 *     ?sort=-weight,name    → weight desc, then name asc (tiebreaker)
 *
 * `buildOrderBy` turns that string into a drizzle `orderBy(...)` array,
 * but only for fields present in the caller's `allowed` whitelist —
 * anything else is silently dropped so a hand-crafted URL can't order
 * by an unindexed / non-existent column. When nothing valid parses
 * (empty param, all-unknown fields), the caller's `fallback` ordering
 * is used instead, keeping each endpoint's default stable.
 */

import { asc, type Column, desc, type SQL } from 'drizzle-orm';

/** Map of URL sort key → the drizzle column / expression to order by. */
export type OrderableMap = Record<string, Column | SQL | SQL.Aliased>;

// `asc()` / `desc()` always return `SQL`, so both the whitelisted terms
// and the fallback are typed as `SQL[]` — exactly what drizzle's
// `.orderBy(...terms)` accepts (a bare `Column` is not).
export function buildOrderBy(
  sort: string | null | undefined,
  allowed: OrderableMap,
  fallback: SQL[],
): SQL[] {
  if (!sort) return fallback;

  const terms: SQL[] = [];
  for (const raw of sort.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const isDesc = token.startsWith('-');
    const key = isDesc ? token.slice(1) : token;
    const col = allowed[key];
    if (!col) continue; // not whitelisted → ignore
    terms.push(isDesc ? desc(col) : asc(col));
  }

  return terms.length > 0 ? terms : fallback;
}
