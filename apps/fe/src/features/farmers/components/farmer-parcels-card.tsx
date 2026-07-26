/**
 * "Parcels" card on the Farmer Detail page.
 *
 * Lists every parcel owned by the farmer. Pulled via
 * `GET /api/parcels?farmerId=<id>` — the farmerId filter landed
 * specifically for this card. Compact table inside the card, each
 * row click → `/farms/<parcelId>`.
 *
 * Header carries the farmer-level shade-tree signal (total tree count
 * + survival % averaged across parcels) so a reader can eyeball the
 * agroforestry state without opening a separate card.
 *
 * Behaviour:
 *  - Loading: 3-row skeleton inside the card body.
 *  - Empty: "No parcels yet" muted line.
 *  - 1+ parcels: compact table sized to the card.
 *  - Gated on `parcel:read`. The whole card is wrapped in
 *    `PermissionGate`; the inner data-loading component only
 *    mounts when the user has permission, so no wasted request
 *    fires when the gate is closed.
 */

import { ChevronRight, MapPin, TriangleAlert } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionGate } from '@/features/auth';
import { formatGhanaDate } from '@/lib/datetime';
import { useParcelsList, useShadeTreesList } from '@/shared/api';
import { ShadeSurvivalBadge } from './shade-survival-badge';

interface Props {
  farmerId: string;
  /** Farmer-level shade tree survival % — arithmetic mean across the
   *  farmer's parcels. Rendered in the card header. */
  shadeSurvivalPct: number | null;
  cardClass?: string;
  cardHeaderClass?: string;
  cardContentClass?: string;
}

/** Inner data + table renderer. Only mounted when the surrounding
 *  PermissionGate matches `parcel:read`, so the SWR fetch never
 *  fires for unauthorized callers. */
function FarmerParcelsCardInner({
  farmerId,
  shadeSurvivalPct,
  cardClass = 'py-4 gap-3',
  cardHeaderClass = 'px-4',
  cardContentClass = 'px-4',
}: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  const { data, isLoading } = useParcelsList({ farmerId, pageSize: 50 });
  const { data: shadeData } = useShadeTreesList({ farmerId, pageSize: 1 });
  const shadeTotal = shadeData?.total ?? 0;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <Card className={cardClass}>
      <CardHeader className={cardHeaderClass}>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="size-4 text-muted-foreground" />
          {t('farmers.detail.parcels')}
          {total > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({total})</span>
          )}
        </CardTitle>
        <CardDescription>{t('farmers.detail.parcelsDescription')}</CardDescription>
        {/* Two-column summary below title/description — mirrors the
            InfoField shape used elsewhere on the farmer detail page
            (label on top, value below). */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('farmers.detail.shadeTree')}
            </span>
            <div className="text-sm text-foreground">{shadeTotal}</div>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('farmers.detail.shadeSurvivalRateLabel')}
            </span>
            <div className="text-sm text-foreground">
              <ShadeSurvivalBadge pct={shadeSurvivalPct} />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cardContentClass}>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <MapPin className="size-6" />
            <span>{t('farmers.detail.noParcelsYet')}</span>
          </div>
        ) : (
          // Contained, rounded-bordered table — sits INSIDE the
          // card's px-4 padding so it has breathing room on all
          // sides, matching the other detail cards on this page.
          <div className="overflow-hidden rounded-md border border-border">
            <Table className="table-fixed min-w-[720px]">
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[140px] bg-muted">
                    {t('farms.table.fieldId')}
                  </TableHead>
                  <TableHead>{t('farms.table.farmName')}</TableHead>
                  <TableHead className="w-[90px] text-right">{t('farms.table.area')}</TableHead>
                  <TableHead className="w-[110px]">{t('farms.table.plantingDate')}</TableHead>
                  <TableHead className="w-[110px]">{t('farmers.table.shadeSurvival')}</TableHead>
                  <TableHead className="w-[120px]">
                    {t('farmers.table.correctiveActions')}
                  </TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  return (
                    <TableRow
                      key={p.id}
                      className={`group/row h-[41px] cursor-pointer text-[13px] [&_td]:py-2 [&_td]:leading-[25px] hover:bg-muted ${
                        p.deletedAt ? 'opacity-60' : ''
                      }`}
                      onClick={() => navigate(`/farms/${encodeURIComponent(p.id)}`)}
                    >
                      <TableCell className="sticky left-0 z-10 bg-card font-mono text-muted-foreground transition-colors group-hover/row:bg-muted">
                        {p.id}
                      </TableCell>
                      <TableCell className="truncate">{p.parcelName ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {p.calculatedAreaHa != null ? p.calculatedAreaHa.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.plantingDate ? formatGhanaDate(p.plantingDate) : '—'}
                      </TableCell>
                      <TableCell>
                        <ShadeSurvivalBadge pct={p.shadeSurvivalPct} />
                      </TableCell>
                      <TableCell>
                        {p.correctiveActions > 0 ? (
                          <StatusTag tone="caution">
                            <TriangleAlert className="size-3" />
                            {p.correctiveActions}
                          </StatusTag>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <ChevronRight className="size-4 inline-block" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FarmerParcelsCard(props: Props) {
  return (
    <PermissionGate codes={['parcel:read']}>
      <FarmerParcelsCardInner {...props} />
    </PermissionGate>
  );
}
