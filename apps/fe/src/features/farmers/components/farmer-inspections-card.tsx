/**
 * "Inspections" card on the Farmer Detail page.
 *
 * Mirrors `FarmerParcelsCard` — pulls every inspection whose
 * `farmer_id` matches this farmer via `GET /api/inspections?farmerId=<id>`.
 * Rendered right below the parcels card so ops can jump from a farmer
 * profile straight into the audit history for their fields.
 *
 * Behaviour:
 *  - Loading: 3-row skeleton inside the card body.
 *  - Empty: "No inspections yet" muted line.
 *  - 1+ inspections: compact table sized to the card, most-recent first.
 *  - Gated on `inspection:read`. The whole card is wrapped in
 *    `PermissionGate`; the inner data-loading component only mounts
 *    when permission matches so no wasted request fires when the gate
 *    is closed.
 */

import { ChevronRight, ClipboardCheck, TriangleAlert } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
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
import { useInspectionsList } from '@/shared/api';
import { CertificationOutcomeBadge } from './certification-outcome-badge';

interface Props {
  farmerId: string;
  cardClass?: string;
  cardHeaderClass?: string;
  cardContentClass?: string;
}

const EUDR_TONE: Record<string, StatusTone> = {
  compliant: 'success',
  non_compliant: 'danger',
  needs_review: 'caution',
  unknown: 'neutral',
};

function FarmerInspectionsCardInner({
  farmerId,
  cardClass = 'py-4 gap-3',
  cardHeaderClass = 'px-4',
  cardContentClass = 'px-4',
}: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  // pageSize 50 — matches the Parcels card. A farmer with more than
  // 50 inspections is out of scope for the profile view; they'd go
  // to the full inspections list with a farmerId filter.
  const { data, isLoading } = useInspectionsList({
    farmerId,
    pageSize: 50,
    // Newest first, then group by parcel so a farmer's history reads
    // as one field-visit per row cluster.
    sort: '-date,parcel_id',
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <Card className={cardClass}>
      <CardHeader className={cardHeaderClass}>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          {t('farmers.detail.inspections')}
          {total > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({total})</span>
          )}
        </CardTitle>
        <CardDescription>{t('farmers.detail.inspectionsDescription')}</CardDescription>
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
            <ClipboardCheck className="size-6" />
            <span>{t('farmers.detail.noInspectionsYet')}</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[110px] bg-muted">
                    {t('inspections.table.date')}
                  </TableHead>
                  <TableHead className="w-[140px]">{t('inspections.table.parcelId')}</TableHead>
                  <TableHead className="w-[130px]">{t('inspections.table.eudr')}</TableHead>
                  <TableHead className="w-[180px]">{t('farmers.table.certificate')}</TableHead>
                  <TableHead className="w-[120px]">
                    {t('inspections.table.correctiveActions')}
                  </TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => {
                  const eudrKey = i.eudrStatus ?? 'unknown';
                  return (
                    <TableRow
                      key={i.id}
                      className="group/row h-[41px] cursor-pointer text-[13px] [&_td]:py-2 [&_td]:leading-[25px] hover:bg-muted"
                      onClick={() => navigate(`/inspections/${i.id}`)}
                    >
                      <TableCell className="sticky left-0 z-10 bg-card text-muted-foreground transition-colors group-hover/row:bg-muted">
                        {formatGhanaDate(i.dateInspection)}
                      </TableCell>
                      <TableCell className="truncate font-mono text-muted-foreground">
                        {i.parcelId ?? '—'}
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={EUDR_TONE[eudrKey] ?? 'neutral'} dot>
                          {t(`inspections.eudr.${eudrKey}`)}
                        </StatusTag>
                      </TableCell>
                      <TableCell>
                        <CertificationOutcomeBadge outcome={i.certificationOutcome} />
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const n = i.followUps.filter((f) => f.status !== 'done').length;
                          return n > 0 ? (
                            <StatusTag tone="caution">
                              <TriangleAlert className="size-3" />
                              {n}
                            </StatusTag>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          );
                        })()}
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

export function FarmerInspectionsCard(props: Props) {
  return (
    <PermissionGate codes={['inspection:read']}>
      <FarmerInspectionsCardInner {...props} />
    </PermissionGate>
  );
}
