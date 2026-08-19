/**
 * Dashboard landing view. Up to four top-level tabs — `traceability`
 * (evacuation lots + purchases folded in), `farmers`, `farms` and `vsla`.
 *
 * Each tab is gated on the permission(s) its data actually needs, and a
 * tab the user can't read is NOT rendered — neither its trigger nor its
 * content — so it never fires an API call that would 403. `dashboard:read`
 * alone lets a role onto this page; what it SEES here is the intersection
 * with the per-domain read perms it holds. The default (first-shown) tab is
 * whichever visible tab comes first, so e.g. a Cooperative Chair who lacks
 * the traceability perms lands on Farmers instead of an empty Traceability.
 *
 * Traceability leads and is code-split: it pulls the breakdown charts, and
 * chart.js in the initial bundle is the very thing the split exists to
 * avoid. Farmers is the one statically imported tab (no charts of its own).
 * The lazy tabs are warmed on browser idle — but only the ones the user can
 * actually see. Radix unmounts inactive tab content, so each tab's data
 * hooks fire only when that tab is shown.
 */

import { Leaf, PackageCheck, PiggyBank, Users as UsersIcon } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/shared/components/composed/page-loader';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { lazyRoute, preloadWhenIdle } from '@/shared/lib/lazy-route';
import { usePermission } from '@/shared/store/useGlobalState';
import { FarmersTab } from './tabs/farmers-tab';

const FarmsTab = lazyRoute(() => import('./tabs/farms-tab'), 'FarmsTab');
const TraceabilityTab = lazyRoute(() => import('./tabs/traceability-tab'), 'TraceabilityTab');
const VslaTab = lazyRoute(() => import('./tabs/vsla-tab'), 'VslaTab');

export function DashboardPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.dashboard') }]);

  // Per-tab permission gates. Each `usePermission` is called
  // unconditionally (rules of hooks) — combine after. Traceability
  // aggregates purchases + both evacuation stages, so it needs all three
  // reads: a role with only some of them would 403 on the missing card.
  const canPurchase = usePermission('purchase:read');
  const canPrimaryEvac = usePermission('primary_evac:read');
  const canSecondaryEvac = usePermission('secondary_evac:read');
  const canTraceability = canPurchase && canPrimaryEvac && canSecondaryEvac;
  const canFarmers = usePermission('farmer:read');
  const canFarms = usePermission('parcel:read');
  const canVsla = usePermission('vsla:read');

  const tabs = [
    canTraceability && {
      value: 'traceability',
      icon: PackageCheck,
      label: t('dashboard.tabs.traceability'),
      lazy: TraceabilityTab,
      node: <TraceabilityTab />,
    },
    canFarmers && {
      value: 'farmers',
      icon: UsersIcon,
      label: t('dashboard.tabs.farmers'),
      lazy: null,
      node: <FarmersTab />,
    },
    canFarms && {
      value: 'farms',
      icon: Leaf,
      label: t('dashboard.tabs.farms'),
      lazy: FarmsTab,
      node: <FarmsTab />,
    },
    canVsla && {
      value: 'vsla',
      icon: PiggyBank,
      label: t('dashboard.tabs.vsla'),
      lazy: VslaTab,
      node: <VslaTab />,
    },
  ].filter((x): x is Exclude<typeof x, false> => x !== false);

  // Warm only the code-split tabs the user can actually open, once idle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: preload fns are stable module refs
  useEffect(() => {
    preloadWhenIdle(
      tabs.map((tab) => tab.lazy?.preload).filter((p): p is () => Promise<unknown> => !!p),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
      </div>

      {tabs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
      ) : (
        <Tabs defaultValue={tabs[0]!.value} className="flex flex-col gap-4">
          <TabsList className="w-fit">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
                <tab.icon className="size-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.lazy ? <Suspense fallback={<PageLoader />}>{tab.node}</Suspense> : tab.node}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
