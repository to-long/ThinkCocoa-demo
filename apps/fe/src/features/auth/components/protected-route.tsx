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
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
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
