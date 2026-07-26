/**
 * Corrective-actions card on the Farm / Parcel detail page.
 *
 * Aggregates the follow-up actions raised for this parcel across BOTH
 * sources — internal inspections AND coaching visits — via the unified
 * `inspection.corrective_actions` table (denormalized `parcel_id`), and
 * renders them with the same amber `CorrectiveActionsCard` used on the
 * inspection-detail page. Gated on `inspection:read`; renders nothing when
 * the parcel has no corrective actions.
 */

import { PermissionGate } from '@/features/auth';
import { CorrectiveActionsCard } from '@/features/inspections/components/corrective-actions-card';
import { useCorrectiveActions } from '@/shared/api';

function ParcelCorrectiveActionsCardInner({ parcelId }: { parcelId: string }) {
  const { data } = useCorrectiveActions({ parcelId });
  return <CorrectiveActionsCard items={data?.items ?? []} />;
}

export function ParcelCorrectiveActionsCard({ parcelId }: { parcelId: string }) {
  return (
    <PermissionGate codes={['inspection:read']}>
      <ParcelCorrectiveActionsCardInner parcelId={parcelId} />
    </PermissionGate>
  );
}
