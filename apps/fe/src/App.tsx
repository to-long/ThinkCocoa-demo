import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { AppShell } from '@/shared/components/composed/app-shell';
import { PageLoader } from '@/shared/components/composed/page-loader';
import type { Locale } from '@/shared/hooks/use-locale';
import { warmRoutesAfterLoad } from '@/shared/lib/route-warmup';

interface AppProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export default function App({ locale, onLocaleChange }: AppProps) {
  // Once the current screen has finished loading, warm every other
  // route's chunk + default list data on idle. Lives here rather than in
  // `Root` so the data half only runs behind `ProtectedRoute` — warming
  // protected endpoints from the login screen would just be 401s.
  useEffect(() => warmRoutesAfterLoad(), []);

  return (
    <AppShell locale={locale} onLocaleChange={onLocaleChange}>
      {/* Page chunks are lazy — keep the shell mounted and only swap the
          content area for a spinner while the next route streams in. */}
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}
