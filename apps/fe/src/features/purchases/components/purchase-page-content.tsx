/**
 * Purchase Management list — mirrors the Pencil `LnBKC` design.
 *
 * Columns: Date · Purchase ID · Farmer · Plot · Society · PC·Station ·
 *          Weight · Amount · Payment · Actions.
 *
 * URL-backed filters + pagination so deep-links survive page reloads
 * (same convention as inspections / coaching / training).
 */

import {
  Banknote,
  Building2,
  CreditCard,
  Eye,
  LandPlot,
  Loader2,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link, useSearchParams } from 'react-router-dom';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LIST_ID_LINK } from '@/lib/link-styles';
import { formatSociety, sortSocieties } from '@/lib/society';
import type { PaymentType } from '@/shared/api';
import { usePurchaseStats, usePurchasesList } from '@/shared/api';
import {
  FarmerRefCell,
  ParcelRefCell,
  RefCell,
} from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { PurchaseStats } from './purchase-stats';

const PAGE_SIZE = 10;

const PAYMENT_CHIP: Record<PaymentType, { tone: StatusTone; Icon: typeof Banknote }> = {
  cash: { tone: 'success', Icon: Banknote },
  mobile_money: { tone: 'info', Icon: Smartphone },
  cheque: { tone: 'caution', Icon: CreditCard },
  card: { tone: 'neutral', Icon: CreditCard },
};

function fmtMoney(usd: number): string {
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtKg(kg: number): string {
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function PurchasePageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.purchases') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const paymentParam = searchParams.get('payment') ?? '';
  const societyParam = searchParams.get('society') ?? '';
  const dateFromParam = searchParams.get('dateFrom') ?? '';
  const dateToParam = searchParams.get('dateTo') ?? '';
  const { sort, hasSort, sorterPropsFor } = useTableSort();
  const pageParsed = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  const updateUrl = (updates: Record<string, string | number | null>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '' || v === undefined) next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      },
      { replace: true },
    );
  };

  const { data: stats } = usePurchaseStats();
  const {
    data: list,
    isLoading,
    isValidating,
    error,
  } = usePurchasesList({
    page,
    pageSize: PAGE_SIZE,
    q: urlQ.trim() || undefined,
    payment: paymentParam || undefined,
    society: societyParam || undefined,
    dateFrom: dateFromParam || undefined,
    dateTo: dateToParam || undefined,
    sort,
  });

  const items = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('purchases.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('purchases.subtitle')}</p>
      </header>

      <PurchaseStats stats={stats} filteredCount={total} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-3"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('purchases.filters.searchPlaceholder')}
          />
          <Select
            value={societyParam || undefined}
            onValueChange={(v) => updateUrl({ society: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={societyParam ? () => updateUrl({ society: null, page: null }) : undefined}
            >
              <Building2 className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('purchases.filters.societyAll')} />
            </SelectTrigger>
            <SelectContent>
              {sortSocieties(stats?.societies ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {formatSociety(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={paymentParam || undefined}
            onValueChange={(v) => updateUrl({ payment: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={paymentParam ? () => updateUrl({ payment: null, page: null }) : undefined}
            >
              <Wallet className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('purchases.filters.paymentAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">{t('purchases.payment.cash')}</SelectItem>
              <SelectItem value="mobile_money">{t('purchases.payment.mobile_money')}</SelectItem>
              <SelectItem value="cheque">{t('purchases.payment.cheque')}</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker
            value={{ from: parseIsoDate(dateFromParam), to: parseIsoDate(dateToParam) }}
            onChange={(r) =>
              updateUrl({
                dateFrom: r.from ? fmtIsoDate(r.from) : null,
                dateTo: r.to ? fmtIsoDate(r.to) : null,
                page: null,
              })
            }
            placeholder={t('purchases.filters.dateRangeAll')}
          />
        </div>
        {(urlQ || societyParam || paymentParam || dateFromParam || dateToParam || hasSort) && (
          <button
            type="button"
            onClick={() => {
              updateUrl({
                q: null,
                society: null,
                payment: null,
                dateFrom: null,
                dateTo: null,
                sort: null,
                page: null,
              });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('purchases.filters.reset')}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error.message ?? String(error)} />}

      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow className="bg-muted">
                <TableHead className="sticky left-0 z-20 bg-muted p-0">
                  <ColumnSorter
                    {...sorterPropsFor('purchase_id')}
                    label={t('purchases.col.purchaseId')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('date')} label={t('purchases.col.date')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('farmer')} label={t('purchases.col.farmer')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('parcel_name')}
                    label={t('purchases.col.parcel')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('society')} label={t('purchases.col.society')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('pc')} label={t('purchases.col.pc')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('weight')}
                    label={t('purchases.col.weight')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('amount')}
                    label={t('purchases.col.amount')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('payment')} label={t('purchases.col.payment')} />
                </TableHead>
                <TableHead className="text-right">{t('purchases.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="p-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="p-12 text-center text-muted-foreground">
                    {t('purchases.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => {
                  const chip = PAYMENT_CHIP[row.paymentType];
                  const Icon = chip.Icon;
                  return (
                    <TableRow key={row.id} className="group/row hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <Link
                          to={`/purchases/${encodeURIComponent(row.purchaseId)}`}
                          className={LIST_ID_LINK}
                        >
                          {row.purchaseId}
                        </Link>
                      </TableCell>
                      <TableCell>{row.purchaseDate}</TableCell>
                      <TableCell>
                        <FarmerRefCell farmerName={row.farmerName} farmerCode={row.farmerCode} />
                      </TableCell>
                      <TableCell>
                        <ParcelRefCell
                          parcelName={row.parcelName}
                          parcelId={row.parcelId ?? row.fieldId}
                        />
                      </TableCell>
                      <TableCell>
                        {row.society ? (
                          <StatusTag tone="lime">
                            <LandPlot className="size-3" />
                            {formatSociety(row.society)}
                          </StatusTag>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Purchasing clerk over their station mark — no
                            route for either, so no link. */}
                        <RefCell name={row.pcName} code={row.stationMarkNumber ?? '—'} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtKg(row.weightKg)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtMoney(row.amountReceived)}
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={chip.tone}>
                          <Icon className="size-3" />
                          {t(`purchases.payment.${row.paymentType}`)}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/purchases/${encodeURIComponent(row.purchaseId)}`}
                          aria-label={t('purchases.action.open')}
                          className="inline-flex cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Eye className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex shrink-0 items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {intl.formatMessage(
              { id: 'purchases.pagination.showing' },
              {
                from: total === 0 ? 0 : offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              },
            )}
            {isValidating && items.length > 0 && (
              <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </span>
          {totalPages > 1 && (
            <DataPagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => updateUrl({ page: p === 1 ? null : p })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
