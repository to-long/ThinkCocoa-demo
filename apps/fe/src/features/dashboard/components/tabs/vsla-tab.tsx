/**
 * Dashboard → VSLA tab (code-split).
 */

import { VslaStats } from '@/features/vsla/components/vsla-stats';
import { useVslaList } from '@/shared/api';
import { VslaBreakdown } from '../dashboard-breakdowns';

function VslaBreakdownSection() {
  // Pull enough of the group list to chart top-N (100 covers every
  // realistic single-coop scope; org-wide the tail truncates gracefully
  // because BarCard has its own sliceLimit).
  const { data } = useVslaList({ page: 1, pageSize: 100 });
  return <VslaBreakdown groups={data?.items} />;
}

export function VslaTab() {
  return (
    <div className="flex flex-col gap-4">
      <VslaStats />
      <VslaBreakdownSection />
    </div>
  );
}
