/**
 * 404 page for an unknown URL (e.g. `/farmers1`).
 *
 * Rendered by the catch-all route INSIDE the protected shell, so the
 * sidebar + header stay visible and the user can navigate away. The
 * "back home" link points at `/`, which `LandingRoute` resolves to a page
 * the user can actually see (or the no-access screen).
 */

import { FileQuestion } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFound() {
  const intl = useIntl();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="size-7" />
      </div>
      <h1 className="font-semibold text-xl text-foreground">
        {intl.formatMessage({ id: 'notFound.title' })}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {intl.formatMessage({ id: 'notFound.description' })}
      </p>
      <Button asChild variant="outline" className="mt-2">
        <Link to="/">{intl.formatMessage({ id: 'notFound.goHome' })}</Link>
      </Button>
    </div>
  );
}
