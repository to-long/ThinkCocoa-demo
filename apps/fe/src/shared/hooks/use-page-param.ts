/**
 * Mirrors a single `?page=N` query-string param into a 1-based integer.
 *
 * Why URL state:
 *   - Refresh preserves position — user doesn't jump back to page 1.
 *   - Shareable deep links (email a colleague "row is on page 3").
 *   - Browser back/forward walks pagination naturally.
 *
 * Conventions:
 *   - Missing or invalid values → page 1.
 *   - Writing `1` REMOVES the param instead of `?page=1`, keeping the
 *     canonical "first page" URL clean.
 *   - Other query params (e.g. `q` for search) are preserved on every
 *     update — we mutate a copy of `prev` rather than replacing the
 *     whole query string.
 *   - Updates use `replace: true` so every page click doesn't spam the
 *     history stack (back button still escapes the page gracefully).
 *
 * @param paramName  Query-string key. Defaults to `"page"`, but pages
 *                   with multiple paginated sections can pass distinct
 *                   names (e.g. `"usersPage"`, `"rolesPage"`).
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function usePageParam(paramName = 'page'): [number, (next: number) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(paramName);
  const parsed = raw === null ? NaN : Number(raw);
  const page = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;

  const setPage = useCallback(
    (next: number) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next <= 1) out.delete(paramName);
          else out.set(paramName, String(next));
          return out;
        },
        { replace: true },
      );
    },
    [paramName, setSearchParams],
  );

  return [page, setPage];
}
