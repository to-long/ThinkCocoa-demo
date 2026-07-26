/**
 * UI-side type aliases for farmer list + detail views.
 * Keeps the BE-facing `ApiFarmer` shape out of the component signatures.
 */

import type { ApiFarmer } from '@/shared/api';

export type FarmerRow = ApiFarmer;

/** Badge bucket used in the list status column — adds the virtual
 *  "deleted" value on top of `active` / `inactive`. */
export type FarmerStatusBucket = 'active' | 'inactive' | 'deleted';

export function farmerStatusBucket(f: ApiFarmer): FarmerStatusBucket {
  if (f.deletedAt) return 'deleted';
  return f.isActive ? 'active' : 'inactive';
}
