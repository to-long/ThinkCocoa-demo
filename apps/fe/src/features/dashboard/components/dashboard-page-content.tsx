/**
 * Dashboard landing view. Four top-level tabs — `traceability`
 * (evacuation lots + purchases folded in), `farmers`, `farms` and `vsla`.
 *
 * Traceability leads and is the default, but stays code-split: it pulls
 * the breakdown charts, and chart.js in the initial bundle is the very
 * thing the split exists to avoid — importing it statically blanked the
 * whole page. Farmers is the one statically imported tab (it has no
 * charts of its own). The lazy tabs are warmed on browser idle so a
 * switch still feels instant. Radix unmounts inactive tab content, so each
 * tab's data hooks fire only when that tab is shown.
 */

import { Leaf, PackageCheck, PiggyBank, Users as UsersIcon } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/shared/components/composed/page-loader';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { lazyRoute, preloadWhenIdle } from '@/shared/lib/lazy-route';
import { FarmersTab } from './tabs/farmers-tab';

const FarmsTab = lazyRoute(() => import('./tabs/farms-tab'), 'FarmsTab');
const TraceabilityTab = lazyRoute(() => import('./tabs/traceability-tab'), 'TraceabilityTab');
const VslaTab = lazyRoute(() => import('./tabs/vsla-tab'), 'VslaTab');

export function DashboardPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.dashboard') }]);

  // Warm the non-active tab chunks once the browser is idle, so clicking
  // Farms / Traceability / VSLA opens instantly instead of fetching a
  // chunk (chart.js included) on click. Doesn't compete with first paint.
  useEffect(
    () => preloadWhenIdle([TraceabilityTab.preload, FarmsTab.preload, VslaTab.preload]),
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
      </div>

      <Tabs defaultValue="traceability" className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="traceability" className="gap-2">
            <PackageCheck className="size-4" />
            {t('dashboard.tabs.traceability')}
          </TabsTrigger>
          <TabsTrigger value="farmers" className="gap-2">
            <UsersIcon className="size-4" />
            {t('dashboard.tabs.farmers')}
          </TabsTrigger>
          <TabsTrigger value="farms" className="gap-2">
            <Leaf className="size-4" />
            {t('dashboard.tabs.farms')}
          </TabsTrigger>
          <TabsTrigger value="vsla" className="gap-2">
            <PiggyBank className="size-4" />
            {t('dashboard.tabs.vsla')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="traceability">
          <Suspense fallback={<PageLoader />}>
            <TraceabilityTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="farmers">
          <FarmersTab />
        </TabsContent>
        <TabsContent value="farms">
          <Suspense fallback={<PageLoader />}>
            <FarmsTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="vsla">
          <Suspense fallback={<PageLoader />}>
            <VslaTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
