/**
 * Cooperative (tenant) switcher — sits in the app header, left of the
 * locale switcher. Single-select: the admin scopes queries to ONE
 * cooperative at a time. Selection persists via the `useActiveCoop`
 * store, which also writes the `active-coop-id` cookie so the BE
 * sees the same scope on every request without a per-page query
 * param.
 *
 * Source of truth for the dropdown options: the `accessibleCooperatives`
 * list returned by `/api/users/me` — already pre-resolved BE-side
 * (org-wide admins → full coop catalog; coop-bound users → their
 * assignment list). One bootstrap fetch instead of two.
 *
 * On first mount, if the store is empty (fresh login or after sign-out)
 * we prefill with the user's primary assignment (or first option) so
 * the cookie is never missing while a session is active.
 *
 * Hidden on `/admin/...` paths by the parent header.
 */

import { Building2, Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  type ActiveCoop,
  selectActiveCoop,
  setActiveCoop,
  useActiveCoop,
} from '@/shared/store/useActiveCoop';
import { selectCurrentUser, useGlobalState } from '@/shared/store/useGlobalState';

// Pathnames where switching coop would orphan the current view —
// you're looking at a specific row that belongs to a specific
// cooperative; flipping the active coop would either 404 the page
// or quietly show data from a different tenant. The switcher is
// rendered but locked (handled below in the component).
//
// Keep in sync with `apps/fe/src/index.tsx` route table.
// `farms/map` is an alternative LIST view (cluster on a map),
// not a detail page — explicitly excluded via negative lookahead.
const DETAIL_ROUTE_PATTERNS = [
  /^\/farmers\/[^/]+\/?$/,
  /^\/farms\/(?!map(?:\/|$))[^/]+\/?$/,
  /^\/inspections\/[^/]+\/?$/,
  /^\/training\/[^/]+\/?$/,
  /^\/coaching\/[^/]+\/?$/,
  /^\/purchases\/[^/]+\/?$/,
  /^\/primary-evacuation\/[^/]+\/?$/,
  /^\/secondary-evacuation\/[^/]+\/?$/,
  /^\/vsla\/[^/]+\/?$/,
  /^\/clmrs\/[^/]+\/?$/,
  /^\/notifications\/[^/]+\/?$/,
  /^\/admin\/users\/[^/]+\/?$/,
  /^\/admin\/cooperatives\/[^/]+\/?$/,
];

export function CoopSwitcher() {
  const currentUser = useGlobalState(selectCurrentUser);
  const active = useActiveCoop(selectActiveCoop);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const switchCoop = (coop: ActiveCoop) => {
    setOpen(false);
    if (coop.cooperativeId === active?.cooperativeId) return;
    if (location.search) {
      navigate(location.pathname, { replace: true });
    }
    setActiveCoop(coop);
  };

  // Org-wide users always render the dropdown shape (with chevron),
  // even when only one coop renders — keeps the layout stable while
  // the catalog data arrives. Coop-bound users with a single coop
  // collapse to the static badge below.
  const isOrgWide = currentUser?.isAllCooperative ?? false;

  const options = useMemo<ActiveCoop[]>(
    () =>
      (currentUser?.accessibleCooperatives ?? []).map((c) => ({
        cooperativeId: c.id,
        cooperativeCode: c.code,
        cooperativeName: c.name,
      })),
    [currentUser],
  );

  // Bootstrap: on fresh login (store empty) prefill with the user's
  // primary assignment — falls back to the first option if no row is
  // flagged primary. Also re-runs when the persisted `active` no longer
  // matches any currently-accessible coop (e.g. the user lost access,
  // the coop was deleted, or the dev DB was reset and UUIDs rotated)
  // — without this re-pick, the trigger label still renders the stale
  // name but no dropdown row gets the check mark and submitting filters
  // sends a coop UUID the BE doesn't know.
  useEffect(() => {
    if (options.length === 0) return;
    const stillValid = active && options.some((o) => o.cooperativeId === active.cooperativeId);
    if (stillValid) return;
    const primary =
      currentUser?.cooperativeAssignments.find((a) => a.isPrimary) ??
      currentUser?.cooperativeAssignments[0];
    const fallback =
      (primary && options.find((o) => o.cooperativeId === primary.cooperativeId)) ?? options[0];
    if (fallback) setActiveCoop(fallback);
  }, [active, options, currentUser]);

  if (!currentUser) return null;
  if (options.length === 0) return null;

  // Detail pages (`/farmers/:id`, `/admin/users/:id`,
  // `/admin/cooperatives/:id`, `/notifications/:id`) display ONE record
  // scoped to the current coop. Switching tenants here would either
  // 404 (record belongs to old coop) or silently show the wrong row,
  // so render the trigger as a static badge — same shape, no
  // dropdown — until the user navigates back to a list page.
  const isDetailPage = DETAIL_ROUTE_PATTERNS.some((re) => re.test(location.pathname));

  const label = active?.cooperativeName ?? options[0].cooperativeName;

  // Brand olive-green — same value as the Cooperatives sidebar icon
  // in `menu-settings.ts`. Hard-coded inline (not a CSS var) so the
  // switcher stays visually anchored to its sidebar counterpart.
  const COOP_TINT = '#5A8A2A';

  // Single-option case: there's nothing to switch to, so render a plain
  // badge instead of a popover trigger. Only applies to NON-org-wide
  // users — for an org-wide admin we always render the dropdown shape,
  // even while `allCoops` is still loading. Otherwise switching coop
  // briefly wipes the SWR cache, `allCoops` is momentarily undefined,
  // we fall back to the user's (often 1-row) assignment list, and the
  // chevron blinks out and back during the revalidate.
  if ((!isOrgWide && options.length === 1) || isDetailPage) {
    return (
      <div
        className="flex h-8 w-[160px] items-center gap-1.5 rounded-md border border-border bg-accent px-2.5 text-foreground"
        title={isDetailPage ? 'Go back to the list to switch cooperative' : undefined}
      >
        <Building2 className="size-3.5 shrink-0" style={{ color: COOP_TINT }} />
        <span className="truncate text-[13px] font-medium leading-none">{label}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex h-8 w-[160px] items-center gap-1.5 rounded-md border border-border bg-accent px-2.5 text-foreground transition-colors hover:bg-sidebar-accent"
        aria-label={`Cooperative: ${label}`}
      >
        <Building2 className="size-3.5 shrink-0" style={{ color: COOP_TINT }} />
        <span className="flex-1 truncate text-left text-[13px] font-medium leading-none">
          {label}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-[160px] p-1"
        showArrow
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {options.map((o) => {
          const isActive = o.cooperativeId === active?.cooperativeId;
          return (
            <button
              key={o.cooperativeId}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-accent"
              onClick={() => switchCoop(o)}
            >
              <Building2 className="size-3.5 shrink-0" style={{ color: COOP_TINT }} />
              <span className="truncate">{o.cooperativeName}</span>
              {isActive && <Check className="ml-auto size-3.5 shrink-0 text-foreground" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
