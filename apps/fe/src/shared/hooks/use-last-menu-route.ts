/**
 * Tracks the most-recent "real" page the user was on so the
 * notification list's Back button has a sensible target.
 *
 * Why we can't just use `navigate(-1)` here:
 *   The notification list is reachable from MANY entry points —
 *   sidebar click, the bell dropdown, a History button on a record
 *   detail page, etc. `navigate(-1)` is fine for the first two but
 *   wrong for the third: the admin came from `/farmers/:id` and
 *   expects Back to return them there, not bounce to whatever they
 *   opened five clicks ago. Tracking the last *menu* page explicitly
 *   gives us a stable, user-meaningful target regardless of the
 *   browser history depth.
 *
 * Storage: `sessionStorage` so it survives full-page reloads inside
 * the same tab but doesn't leak across sessions / tabs.
 *
 * Skipped routes: anything under `/notifications` (list + detail) is
 * NOT recorded — we don't want Back from /notifications/<id> to land
 * back on /notifications, that's a no-op loop.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'kuanadata:lastMenuRoute';

/** Pathname prefixes that should NOT be recorded as "last menu". */
const SKIP_PREFIXES = ['/notifications'];

function shouldRecord(pathname: string): boolean {
  return !SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Mount this once at the app shell. It records the current location
 * (pathname + search) to sessionStorage on every route change, as long
 * as the path isn't on the skip list.
 */
export function useTrackLastMenuRoute() {
  const location = useLocation();
  useEffect(() => {
    if (!shouldRecord(location.pathname)) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, location.pathname + location.search);
    } catch {
      // sessionStorage can throw in private-mode Safari etc. — non-fatal.
    }
  }, [location.pathname, location.search]);
}

/**
 * Returns the last recorded "real" page, or null if none. Caller
 * decides the fallback (typically `/` for the dashboard).
 */
export function getLastMenuRoute(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
