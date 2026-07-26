/**
 * Dashboard → Traceability tab (code-split). Purchases + primary/
 * secondary evacuation, following the cocoa flow farm → 1st → 2nd evac.
 */

import { useIntl } from 'react-intl';
import { PrimaryEvacStats } from '@/features/primary-evac/components/primary-evac-stats';
import { PurchaseStats } from '@/features/purchases/components/purchase-stats';
import { TraceabilityStats } from '@/features/traceability/components/traceability-stats';
import { usePrimaryEvacStats, usePurchaseStats, useSecondaryEvacStats } from '@/shared/api';
import {
  PrimaryEvacBreakdown,
  PurchasesBreakdown,
  TraceabilityBreakdown,
} from '../dashboard-breakdowns';

function PurchasesSection() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data: stats } = usePurchaseStats();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold text-base text-foreground">
        {t('dashboard.purchases.sectionTitle')}
      </h2>
      <PurchaseStats stats={stats} />
      <PurchasesBreakdown stats={stats} />
    </div>
  );
}

function PrimaryEvacSection() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data: stats } = usePrimaryEvacStats();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold text-base text-foreground">
        {t('dashboard.primaryEvac.sectionTitle')}
      </h2>
      <PrimaryEvacStats stats={stats} />
      <PrimaryEvacBreakdown stats={stats} />
    </div>
  );
}

function SecondaryEvacSection() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data: stats } = useSecondaryEvacStats();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold text-base text-foreground">
        {t('dashboard.secondaryEvac.sectionTitle')}
      </h2>
      <TraceabilityStats stats={stats} />
      <TraceabilityBreakdown stats={stats} />
    </div>
  );
}

export function TraceabilityTab() {
  return (
    <div className="flex flex-col gap-6">
      <PurchasesSection />
      <PrimaryEvacSection />
      <SecondaryEvacSection />
    </div>
  );
}
