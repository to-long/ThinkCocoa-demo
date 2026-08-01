/**
 * 403 landing shown when `RequirePermission` blocks a route.
 *
 * Rendered INSIDE the protected layout (sidebar + header still visible)
 * so the user isn't ejected from the shell — they can navigate to any
 * other page they DO have access to via the sidebar or the "back" link.
 *
 * Shows the literal required permission codes — surfacing what the user
 * would need to request from an admin is more useful than a generic
 * "access denied" banner.
 */

import type { PermissionCode } from '@thinkcocoa/shared';
import { ShieldOff } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { NoAccess, useHasAnyAccessiblePage } from '@/features/auth/components/landing-route';

interface ForbiddenProps {
  /** Optional — surfacing the codes helps the user file a precise ticket. */
  requiredCodes?: readonly PermissionCode[];
}

export function Forbidden({ requiredCodes }: ForbiddenProps) {
  const intl = useIntl();
  // A user who can't reach ANY page has nowhere to go "back" to — every
  // route would bounce them here. Show the terminal no-access screen
  // (contact-admin + sign-out) instead of a dead "Back to dashboard".
  const hasAnyAccess = useHasAnyAccessiblePage();
  if (!hasAnyAccess) return <NoAccess />;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldOff className="size-7" />
      </div>
      <h1 className="font-semibold text-xl text-foreground">
        {intl.formatMessage({ id: 'forbidden.title' })}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {intl.formatMessage({ id: 'forbidden.description' })}
      </p>
      {requiredCodes && requiredCodes.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {intl.formatMessage({ id: 'forbidden.requiredLabel' })}
          </span>
          {requiredCodes.map((c) => (
            <code
              key={c}
              className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
            >
              {c}
            </code>
          ))}
        </div>
      )}
      <Button asChild variant="outline" className="mt-2">
        <Link to="/">{intl.formatMessage({ id: 'forbidden.goBack' })}</Link>
      </Button>
    </div>
  );
}
