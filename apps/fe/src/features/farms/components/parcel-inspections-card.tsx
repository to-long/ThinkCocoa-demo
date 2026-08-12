/**
 * "Internal Inspections" card on the Farm / Parcel Detail page.
 *
 * Mirrors `FarmerInspectionsCard` but scoped to a single parcel — pulls
 * every inspection whose `parcel_id` matches via
 * `GET /api/inspections?parcelId=<id>`. Rendered right below the Map
 * Geometry card so ops can jump from a field straight into its audit
 * history.
 *
 * Since every row belongs to the same parcel, the Parcel-ID column is
 * dropped in favour of the Inspector column. Gated on `inspection:read`;
 * the inner data-loading component only mounts when permission matches so
 * no wasted request fires when the gate is closed.
 */

import { ChevronRight, ClipboardCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataPagination } from '@/components/ui/data-pagination';
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
import { CertificationOutcomeBadge } from '@/features/farmers/components/certification-outcome-badge';
import { formatDate } from '@/lib/datetime';
import { useInspectionsList } from '@/shared/api';

interface Props {
  parcelId: string;
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

/** Rows per page — client-side paging over the already-fetched list. */
const PAGE_SIZE = 10;

function ParcelInspectionsCardInner({
  parcelId,
  cardClass = 'py-4 gap-3',
  cardHeaderClass = 'px-4',
  cardContentClass = 'px-4',
}: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useInspectionsList({
    parcelId,
    pageSize: 50,
    // Newest first — the parcel's most recent audit at the top.
    sort: '-date',
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  // Client-side paging (10/page) over the fetched rows so a parcel with
  // many audits doesn't render one giant scroll. Clamp the page in case
  // the row count shrinks below the current page.
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <Card className={cardClass}>
      <CardHeader className={cardHeaderClass}>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          {t('farms.detail.inspections')}
          {total > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({total})</span>
          )}
        </CardTitle>
        <CardDescription>{t('farms.detail.inspectionsDescription')}</CardDescription>
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
            <span>{t('farms.detail.noInspectionsYet')}</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table className="table-fixed min-w-[720px]">
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[110px] bg-muted">
                    {t('inspections.table.date')}
                  </TableHead>
                  <TableHead>{t('inspections.table.inspector')}</TableHead>
                  <TableHead className="w-[130px]">{t('inspections.table.eudr')}</TableHead>
                  <TableHead className="w-[180px]">{t('farmers.table.certificate')}</TableHead>
                  <TableHead className="w-[120px]">
                    {t('inspections.table.correctiveActions')}
                  </TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((i) => {
                  const eudrKey = i.eudrStatus ?? 'unknown';
                  return (
                    <TableRow
                      key={i.id}
                      className="group/row h-[41px] cursor-pointer text-[13px] [&_td]:py-2 [&_td]:leading-[25px] hover:bg-muted"
                      onClick={() => navigate(`/inspections/${i.id}`)}
                    >
                      <TableCell className="sticky left-0 z-10 bg-card text-muted-foreground transition-colors group-hover/row:bg-muted">
                        {formatDate(i.dateInspection)}
                      </TableCell>
                      <TableCell className="truncate text-muted-foreground">
                        {i.inspectorCode ?? '—'}
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
        {items.length > PAGE_SIZE && (
          <DataPagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            className="mt-3"
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ParcelInspectionsCard(props: Props) {
  return (
    <PermissionGate codes={['inspection:read']}>
      <ParcelInspectionsCardInner {...props} />
    </PermissionGate>
  );
}
