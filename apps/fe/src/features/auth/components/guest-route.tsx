import { Navigate, Outlet } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';

/**
 * Routes only accessible to non-authenticated users (login, register, etc.).
 * Redirects to / if user is already authenticated.
 */
export function GuestRoute() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
      </div>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
