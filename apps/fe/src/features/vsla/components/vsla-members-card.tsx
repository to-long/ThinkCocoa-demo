/**
 * VSLA member roster + per-member ledger.
 *
 * Sits under the monthly-report table on the group detail page and answers
 * the question that table can't: *who* is in this group, and what does one
 * member's own savings and borrowing look like.
 *
 * Members are real farmers, so the name cell links to the farmer profile.
 * Clicking the row opens the ledger dialog instead of navigating, because
 * the numbers only mean anything next to the group they belong to.
 *
 * The figures are derived server-side from the group's own report history
 * (see `apps/be/src/features/vsla/members.ts`): the balance column sums to
 * the group's cumulative savings and the loan states match the latest
 * report's counts, so this card can never contradict the table above it.
 */

import { Coins, HandCoins, PiggyBank, Users } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatSociety } from '@/lib/society';
import { type ApiVslaMember, useVslaMemberLedger, useVslaMembers } from '@/shared/api';
import { RefCell } from '@/shared/components/composed/entity-ref-cell';

const LOAN_TONE: Record<ApiVslaMember['loanStatus'], StatusTone> = {
  none: 'neutral',
  active: 'info',
  late: 'danger',
  repaid: 'success',
};

function usd(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

function monthShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

interface Props {
  /** Group uuid or group number — whatever the detail page was loaded with. */
  groupId: string;
  shareValue: number | null;
}

export function VslaMembersCard({ groupId, shareValue }: Props) {
  const intl = useIntl();
  const t = (k: string, v?: Record<string, string | number>) => intl.formatMessage({ id: k }, v);
  const { data, isLoading } = useVslaMembers(groupId);
  const [openFarmerId, setOpenFarmerId] = useState<string | null>(null);

  const members = data?.items ?? [];
  const totalSavings = members.reduce((s, m) => s + m.savingsBalance, 0);
  const withLoans = members.filter((m) => m.loanStatus !== 'none').length;

  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-col gap-1 p-4 pb-0">
        <h2 className="flex items-center gap-2 font-semibold text-base text-foreground">
          <Users className="size-4 text-muted-foreground" />
          {t('vsla.members.title')}
        </h2>
        <p className="text-muted-foreground text-xs">{t('vsla.members.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Roster totals — the reconciliation cue: this sums to the group's
            cumulative savings shown in the KPI tiles. */}
        {members.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone="lime">
              <Users className="size-3" />
              {t('vsla.members.countTag', { n: members.length })}
            </StatusTag>
            <StatusTag tone="info2">
              <PiggyBank className="size-3" />
              {usd(totalSavings)}
            </StatusTag>
            {withLoans > 0 && (
              <StatusTag tone="info">
                <HandCoins className="size-3" />
                {t('vsla.members.withLoansTag', { n: withLoans })}
              </StatusTag>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="sticky left-0 z-20 w-[200px] bg-muted pl-2">
                  {t('vsla.members.col.member')}
                </TableHead>
                <TableHead className="w-[160px]">{t('vsla.members.col.society')}</TableHead>
                <TableHead className="w-[110px]">{t('vsla.members.col.joined')}</TableHead>
                <TableHead className="w-[100px] text-right">
                  {t('vsla.members.col.shares')}
                </TableHead>
                <TableHead className="w-[130px] text-right">
                  {t('vsla.members.col.savings')}
                </TableHead>
                <TableHead className="w-[150px]">{t('vsla.members.col.loan')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t('vsla.members.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow
                    key={m.farmerId}
                    className="group/row h-[44px] cursor-pointer text-[13px] hover:bg-muted"
                    onClick={() => setOpenFarmerId(m.farmerId)}
                  >
                    <TableCell className="sticky left-0 z-10 bg-card pl-2 transition-colors group-hover/row:bg-muted">
                      <RefCell
                        name={m.farmerName}
                        code={m.farmerId}
                        codeValue={m.farmerId}
                        basePath="/farmers"
                        permission="farmer:read"
                      />
                    </TableCell>
                    <TableCell>
                      {m.society ? (
                        <StatusTag tone="lime">{formatSociety(m.society)}</StatusTag>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {monthShort(m.joinedMonth)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.sharesOwned || '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {usd(m.savingsBalance)}
                    </TableCell>
                    <TableCell>
                      {m.loanStatus === 'none' ? (
                        <span className="text-muted-foreground">{t('vsla.members.loan.none')}</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1 leading-tight">
                          <StatusTag tone={LOAN_TONE[m.loanStatus]}>
                            {t(`vsla.members.loan.${m.loanStatus}`)}
                          </StatusTag>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {usd(m.loanOutstanding)} {t('vsla.members.outstanding')}
                          </span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <MemberLedgerDialog
        groupId={groupId}
        farmerId={openFarmerId}
        shareValue={shareValue}
        onClose={() => setOpenFarmerId(null)}
      />
    </section>
  );
}

function MemberLedgerDialog({
  groupId,
  farmerId,
  shareValue,
  onClose,
}: {
  groupId: string;
  farmerId: string | null;
  shareValue: number | null;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (k: string, v?: Record<string, string | number>) => intl.formatMessage({ id: k }, v);
  const { data: ledger, isLoading } = useVslaMemberLedger(groupId, farmerId);

  return (
    <Dialog open={farmerId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader className="border-b-0">
          <h3 className="font-semibold text-lg">
            {ledger?.farmerName ?? t('vsla.members.ledger.title')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {ledger
              ? t('vsla.members.ledger.subtitle', {
                  group: ledger.groupName,
                  joined: monthShort(ledger.joinedMonth),
                })
              : t('vsla.members.ledger.loading')}
          </p>
        </DialogHeader>

        <DialogBody>
          {isLoading || !ledger ? (
            <p className="py-8 text-center text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Balance strip — the three numbers a field officer is asked
                  for at a meeting. */}
              <div className="grid grid-cols-3 gap-2">
                <Kpi
                  icon={PiggyBank}
                  label={t('vsla.members.ledger.balance')}
                  value={usd(ledger.savingsBalance)}
                />
                <Kpi
                  icon={Coins}
                  label={t('vsla.members.ledger.shares')}
                  value={
                    shareValue
                      ? t('vsla.members.ledger.sharesValue', {
                          n: ledger.sharesOwned,
                          value: usd(shareValue),
                        })
                      : String(ledger.sharesOwned || '—')
                  }
                />
                <Kpi
                  icon={HandCoins}
                  label={t('vsla.members.ledger.outstanding')}
                  value={usd(ledger.totals.loansOutstanding)}
                  tone={ledger.loanStatus === 'late' ? 'danger' : undefined}
                />
              </div>

              {/* Loans first: it's the exception that needs attention, and
                  it's the shorter list. */}
              <div className="flex flex-col gap-2">
                <h4 className="font-semibold text-foreground text-sm">
                  {t('vsla.members.ledger.loansTitle')}
                </h4>
                {ledger.loans.length === 0 ? (
                  <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
                    {t('vsla.members.ledger.loansEmpty')}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableHead>{t('vsla.members.ledger.disbursed')}</TableHead>
                          <TableHead>{t('vsla.members.ledger.due')}</TableHead>
                          <TableHead className="text-right">
                            {t('vsla.members.ledger.principal')}
                          </TableHead>
                          <TableHead className="text-right">
                            {t('vsla.members.ledger.repaid')}
                          </TableHead>
                          <TableHead>{t('vsla.members.ledger.status')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ledger.loans.map((l) => (
                          <TableRow key={l.id} className="h-[40px] text-[13px]">
                            <TableCell>{monthShort(l.disbursedOn)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {monthShort(l.dueOn)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {usd(l.principal)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {usd(l.repaid)}
                            </TableCell>
                            <TableCell>
                              <StatusTag tone={LOAN_TONE[l.status]}>
                                {t(`vsla.members.loan.${l.status}`)}
                              </StatusTag>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Savings history, newest first to match the group's own
                  report table on the page behind this dialog. */}
              <div className="flex flex-col gap-2">
                <h4 className="font-semibold text-foreground text-sm">
                  {t('vsla.members.ledger.savingsTitle')}
                </h4>
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted hover:bg-muted">
                        <TableHead>{t('vsla.table.month')}</TableHead>
                        <TableHead className="text-right">
                          {t('vsla.members.ledger.contribution')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('vsla.members.ledger.runningBalance')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...ledger.savings].reverse().map((e) => (
                        <TableRow key={e.month} className="h-[38px] text-[13px]">
                          <TableCell>{monthShort(e.month)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {e.contribution >= 0 ? '+' : ''}
                            {usd(e.contribution)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {usd(e.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof PiggyBank;
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span
        className={`font-semibold text-base tabular-nums ${
          tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
