/**
 * Dashboard → Farmers tab. Kept statically imported (it's the default
 * active tab) so the first paint needs no extra chunk fetch. The other
 * three tabs are code-split (see dashboard-page-content).
 */

import { FarmersSlimStats } from '@/features/farmers/components/farmers-slim-stats';
import { FarmerStatsSection } from '../farmer-stats-section';

export function FarmersTab() {
  // Compact at-a-glance row (slim stats endpoint) sits above the full
  // breakdown so admins see headline numbers first without scrolling.
  // Both share one server-side LRU so rendering both is ~free.
  return (
    <div className="flex flex-col gap-4">
      <FarmersSlimStats />
      <FarmerStatsSection />
    </div>
  );
}
