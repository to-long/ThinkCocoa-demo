/**
 * Route → data preloader map. Pairs with the chunk registry in
 * `lazy-route`: the post-load warm-up (`route-warmup`) walks both, so a
 * route gets its JS chunk AND its SWR cache — the default (page 1, no
 * filter) list rows + stat cards — warmed together and the click renders
 * the table straight from cache instead of a loading skeleton.
 *
 * Best-effort: only the param-free default key is warmed, so a
 * filtered/paged mount just misses and fetches live. Every warm goes
 * through `quietFetch`, so a rejected speculative read (a forbidden
 * endpoint, a tab-resume blip) stays silent and never redirects the app.
 */

import { prefetchCoachingList } from '@/shared/api/coaching';
import { prefetchFarmersList } from '@/shared/api/farmers';
import { prefetchInspectionsList } from '@/shared/api/inspections';
import { prefetchParcelsList } from '@/shared/api/parcels';
import { prefetchPrimaryEvacList } from '@/shared/api/primary-evac';
import { prefetchPurchaseList } from '@/shared/api/purchases';
import { prefetchSecondaryEvacList } from '@/shared/api/secondary-evac';
import { prefetchTrainingList } from '@/shared/api/training';
import { prefetchVslaList } from '@/shared/api/vsla';

export const routeDataPreloaders: Record<string, () => void> = {
  '/farmers': prefetchFarmersList,
  '/farms': prefetchParcelsList,
  '/vsla': prefetchVslaList,
  '/inspections': prefetchInspectionsList,
  '/training': prefetchTrainingList,
  '/coaching': prefetchCoachingList,
  '/purchases': prefetchPurchaseList,
  '/primary-evacuation': prefetchPrimaryEvacList,
  '/secondary-evacuation': prefetchSecondaryEvacList,
};
