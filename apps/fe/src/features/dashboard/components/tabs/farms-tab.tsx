/**
 * Dashboard → Farms tab (code-split). Heavy breakdown charts ride in
 * this chunk instead of the dashboard's first-paint bundle.
 */

import { FarmsStats } from '@/features/farms/components/farms-stats';
import { useCorrectiveActionStats, useParcelStats } from '@/shared/api';
import { CorrectiveActionsBreakdown, FarmsBreakdown } from '../dashboard-breakdowns';

function FarmsBreakdownSection() {
  const { data: stats } = useParcelStats();
  return <FarmsBreakdown stats={stats} />;
}

function CorrectiveActionsSection() {
  const { data: stats } = useCorrectiveActionStats();
  return <CorrectiveActionsBreakdown stats={stats} />;
}

export function FarmsTab() {
  return (
    <div className="flex flex-col gap-4">
      <FarmsStats />
      <FarmsBreakdownSection />
      <CorrectiveActionsSection />
    </div>
  );
}
