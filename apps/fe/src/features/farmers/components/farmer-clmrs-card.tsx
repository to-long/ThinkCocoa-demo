/**
 * "CLMRS" card on the Farmer Detail page.
 *
 * Mirrors `FarmerInspectionsCard` — lists every hazardous-work
 * observation (flag) for this farmer's children, with the case
 * status joined in when a case has been opened. Uses the same
 * mock data source as `/clmrs` so both surfaces stay coherent.
 *
 * Actions per row match the main CLMRS list:
 *   • Row has a case → eye icon → `/clmrs/cases/:id`
 *   • Row is pending → "Create case" button opens the dialog.
 *
 * The card self-gates on `farmer:read` (temporary permission —
 * swap to `clmrs:read` when the BE lands). Empty state shows a
 * quiet muted line rather than removing the card, so ops can
 * distinguish "no records" from "component missing".
 */

import { AlertTriangle, ChevronRight, ShieldAlert } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ClmrsStatusPill } from '@/features/clmrs/components/clmrs-status-pill';
import { listRecordsForFarmer } from '@/features/clmrs/lib/mock';
import { formatDate } from '@/lib/datetime';

interface Props {
  farmerId: string;
  cardClass?: string;
  cardHeaderClass?: string;
  cardContentClass?: string;
}

export function FarmerClmrsCard({ farmerId, cardClass, cardHeaderClass, cardContentClass }: Props) {
  return (
    <PermissionGate codes={['farmer:read']}>
      <FarmerClmrsCardInner
        farmerId={farmerId}
        cardClass={cardClass}
        cardHeaderClass={cardHeaderClass}
        cardContentClass={cardContentClass}
      />
    </PermissionGate>
  );
}

function FarmerClmrsCardInner({ farmerId, cardClass, cardHeaderClass, cardContentClass }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();
  const t = (k: string) => intl.formatMessage({ id: k });

  const records = listRecordsForFarmer(farmerId);

  const totals = {
    pending: records.filter((r) => !r.case).length,
    open: records.filter((r) => r.case?.status === 'open').length,
    closed: records.filter((r) => r.case?.status === 'closed').length,
  };

  return (
    <Card className={cardClass}>
      <CardHeader className={cardHeaderClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-muted-foreground" />
              {t('farmers.detail.clmrs')}
            </CardTitle>
            <CardDescription>{t('farmers.detail.clmrsDescription')}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {totals.open > 0 && (
              <StatusTag tone="danger">
                {intl.formatMessage({ id: 'farmers.detail.clmrsOpenCount' }, { n: totals.open })}
              </StatusTag>
            )}
            {totals.pending > 0 && (
              <StatusTag tone="success">
                {intl.formatMessage(
                  { id: 'farmers.detail.clmrsPendingCount' },
                  { n: totals.pending },
                )}
              </StatusTag>
            )}
            {totals.closed > 0 && (
              <StatusTag tone="caution">
                {intl.formatMessage(
                  { id: 'farmers.detail.clmrsClosedCount' },
                  { n: totals.closed },
                )}
              </StatusTag>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={cardContentClass}>
        {records.length === 0 ? (
          <div className="rounded-md border border-border border-dashed bg-muted/30 px-4 py-6 text-center">
            <p className="text-muted-foreground text-sm">{t('farmers.detail.clmrsEmpty')}</p>
          </div>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="sticky left-0 z-20 bg-muted">
                    {t('clmrs.table.child')}
                  </TableHead>
                  <TableHead className="w-[120px]">{t('clmrs.table.source')}</TableHead>
                  <TableHead className="w-[110px] text-right">
                    {t('farmers.detail.clmrsFlagCount')}
                  </TableHead>
                  <TableHead className="w-[170px]">{t('clmrs.table.caseStatus')}</TableHead>
                  <TableHead className="w-[110px]">{t('clmrs.table.lastVisit')}</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => {
                  const f = r.flag;
                  const c = r.case;
                  return (
                    <TableRow
                      key={f.childId}
                      className="group/row h-[44px] cursor-pointer text-[13px] hover:bg-muted"
                      onClick={() => navigate(`/clmrs/${f.childId}`)}
                    >
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <div className="flex flex-col leading-tight">
                          <span className="font-medium text-foreground">{f.childNameDisplay}</span>
                          {f.childDob && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              DOB {formatDate(f.childDob)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={f.source === 'household_visit' ? 'info' : 'lime'}>
                          {f.source === 'household_visit'
                            ? t('clmrs.source.householdVisit')
                            : t('clmrs.source.farmVisit')}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusTag tone="caution">
                          <AlertTriangle className="size-3" />
                          {f.flaggedActivities.length}
                        </StatusTag>
                      </TableCell>
                      <TableCell>
                        {c ? (
                          <div className="flex flex-col leading-tight">
                            <ClmrsStatusPill status={c.status} />
                            <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                              {c.clmrsCode}
                            </span>
                          </div>
                        ) : (
                          <ClmrsStatusPill status="pending" />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c?.lastVisitDate ? formatDate(c.lastVisitDate) : '—'}
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
