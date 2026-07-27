import { Navigate, Outlet } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';
import { useBootstrapGlobalState } from '@/shared/hooks/use-bootstrap-global-state';
import { selectBootstrapped, useGlobalState } from '@/shared/store/useGlobalState';

/**
 * Protects routes that require authentication.
 * Redirects to /login if user is not authenticated.
 *
 * Also bootstraps `useGlobalState` (identity + effective permissions)
 * once the session is confirmed, then HOLDS on a spinner until that
 * bootstrap completes. Downstream guards (`RequirePermission`) and the
 * sidebar filter can then read `currentUserPermissions` without racing
 * the initial fetch — otherwise the user would briefly see a Forbidden
 * page or an empty sidebar before permissions arrive.
 */
function AuthedShell({ userId }: { userId: string }) {
  useBootstrapGlobalState(userId);
  const bootstrapped = useGlobalState(selectBootstrapped);

  if (!bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
      </div>
    );
  }

  return <Outlet />;
}

export function ProtectedRoute() {
  const { data: session, isPending, error } = authClient.useSession();

  // `error` = we never got an answer (backend restarting, connection
  // dropped), which says nothing about whether the session is valid. Only
  // a clean "no session" answer means signed out. Kicking to /login on a
  // failed request is what made every backend blip look like a logout —
  // same distinction the API fetcher draws between `rejected` and
  // `unavailable`.
  if (isPending || error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <AuthedShell userId={session.user.id} />;
}
