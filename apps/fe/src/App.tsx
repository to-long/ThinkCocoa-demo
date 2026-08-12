import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { AppShell } from '@/shared/components/composed/app-shell';
import { PageLoader } from '@/shared/components/composed/page-loader';
import type { Locale } from '@/shared/hooks/use-locale';
import { warmRoutesAfterLoad } from '@/shared/lib/route-warmup';
import { selectActiveCoopId, useActiveCoop } from '@/shared/store/useActiveCoop';

interface AppProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export default function App({ locale, onLocaleChange }: AppProps) {
  const activeCoopId = useActiveCoop(selectActiveCoopId);

  // Once the current screen has finished loading, warm every other route's
  // chunk + default list data on idle. Lives here rather than in `Root` so
  // the data half only runs behind `ProtectedRoute` — warming protected
  // endpoints from the login screen would just be 401s.
  //
  // Re-run on active-coop change: `setActiveCoop` wipes the SWR cache, but
  // the warmed `preload` entries would otherwise refill lazily / keep the
  // previous coop's promises. Re-warming repopulates every prefetch with the
  // NEW coop's data (the cleanup cancels the previous coop's in-flight warm).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-warm keyed on coop
  useEffect(() => warmRoutesAfterLoad(), [activeCoopId]);

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
