/**
 * Index (`/`) resolver.
 *
 * The landing page is the dashboard, gated on `dashboard:read`. A user
 * without it shouldn't hit a dead 403 at the app's front door — instead:
 *
 *   1. has `dashboard:read`  → render the dashboard (passed as children so
 *      it stays lazy in the route table).
 *   2. lacks it but can read *something* → redirect to the first nav page
 *      they DO have access to, in sidebar order.
 *   3. can access nothing at all → a terminal "no access" screen telling
 *      them to contact an admin, with a sign-out button (their account has
 *      no usable permissions, so there's nowhere to send them).
 *
 * `ProtectedRoute` already holds on a spinner until the permission set is
 * populated, so `perms` is trustworthy by the time this renders.
 */

import type { PermissionCode } from '@thinkcocoa/shared';
import { LogOut, ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { selectCurrentUserPermissions, useGlobalState } from '@/shared/store/useGlobalState';
import { useSignOut } from '../hooks/use-sign-out';

/** Nav destinations in sidebar order, each with the permission that
 *  unlocks it. First match wins as the redirect target. Keep in sync with
 *  the route table in `index.tsx` and the sidebar in `menu-settings.ts`. */
type LandingEntry = { path: string; codes?: readonly PermissionCode[]; suffix?: string };
const LANDING_ROUTES: readonly LandingEntry[] = [
  { path: '/farmers', codes: ['farmer:read'] },
  { path: '/farms', codes: ['parcel:read'] },
  { path: '/vsla', codes: ['farmer:read'] },
  { path: '/training', codes: ['training:read'] },
  { path: '/coaching', codes: ['coaching:read'] },
  { path: '/purchases', codes: ['purchase:read'] },
  { path: '/primary-evacuation', codes: ['primary_evac:read'] },
  { path: '/secondary-evacuation', codes: ['secondary_evac:read'] },
  { path: '/inspections', codes: ['inspection:read'] },
  { path: '/clmrs', codes: ['farmer:read'] },
  { path: '/reports', codes: ['report:read'] },
  { path: '/notifications', suffix: ':notification' },
  { path: '/admin/cooperatives', codes: ['cooperative:read'] },
  { path: '/admin/users', codes: ['user:read'] },
  { path: '/admin/roles', codes: ['role:read'] },
  { path: '/admin/permissions', codes: ['permission:read'] },
  { path: '/admin/sync', codes: ['sync:config'] },
];

function hasAccess(perms: readonly string[], entry: LandingEntry): boolean {
  if (entry.suffix) return perms.some((p) => p.endsWith(entry.suffix as string));
  return !!entry.codes?.some((c) => perms.includes(c));
}

/**
 * True when the signed-in user can reach at least one page — the dashboard
 * or any nav destination. `Forbidden` uses this to decide whether a 403 is
 * "you lack THIS page" (offer a way back) vs "you have no access at all"
 * (offer sign-out instead). Returns true while the permission set is still
 * loading so the no-access screen never flashes during bootstrap.
 */
export function useHasAnyAccessiblePage(): boolean {
  const perms = useGlobalState(selectCurrentUserPermissions);
  if (perms === null) return true;
  return perms.includes('dashboard:read') || LANDING_ROUTES.some((r) => hasAccess(perms, r));
}

export function LandingRoute({ children }: { children: ReactNode }) {
  const perms = useGlobalState(selectCurrentUserPermissions);

  // `null` = bootstrap not finished. ProtectedRoute already gates on this;
  // render nothing rather than flashing the no-access screen.
  if (perms === null) return null;

  if (perms.includes('dashboard:read')) return <>{children}</>;

  const target = LANDING_ROUTES.find((r) => hasAccess(perms, r));
  if (target) return <Navigate to={target.path} replace />;

  return <NoAccess />;
}

/** Terminal screen for an account with no usable read permission. */
export function NoAccess() {
  const intl = useIntl();
  const signOut = useSignOut();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldOff className="size-7" />
      </div>
      <h1 className="font-semibold text-xl text-foreground">
        {intl.formatMessage({ id: 'noAccess.title' })}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {intl.formatMessage({ id: 'noAccess.description' })}
      </p>
      <Button variant="outline" className="mt-2" onClick={() => void signOut()}>
        <LogOut className="size-4" />
        {intl.formatMessage({ id: 'noAccess.logout' })}
      </Button>
    </div>
  );
}
