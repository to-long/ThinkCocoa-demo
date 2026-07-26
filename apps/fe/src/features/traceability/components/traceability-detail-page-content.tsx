/**
 * Secondary Evacuation Detail — mirrors Pencil `zXKH1`.
 *
 * Sections:
 *   1. Page header — Title + subtitle
 *   2. Hero card — WB + Evacuated date + Warehouse → Port route tags
 *   3. Stat tiles (4-up) — Bags · Weight · Avg bag · Evac date
 *   4. Lot composition — primary lots with expandable purchase drilldown
 *   5. Transport Detail — route line + driver/truck/license/seal
 */

import {
  Anchor,
  Boxes,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  MoveRight,
  Package,
  Scale,
  ShieldCheck,
  TriangleAlert,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useParams } from 'react-router-dom';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type ApiTraceabilityPrimaryLotRow, useSecondaryEvacLot } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

const KG_PER_BAG = 64;

function fmtKg(kg: number | null | undefined): string {
  if (kg == null) return '—';
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Shared column template so the outer lot rows and the inner purchase
// drilldown line up edge-to-edge. col1 = expand toggle / indent (sticky),
// then Waybill|PurchaseId · # · # · name(1fr) · weight. Both tables live
// in one horizontal-scroll container and pin their first column.
const LOT_GRID = 'grid grid-cols-[36px_190px_100px_100px_minmax(150px,1fr)_96px] gap-3';

export function TraceabilityDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data, isLoading, error } = useSecondaryEvacLot(id);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useBreadcrumb([
    { label: t('navigation.secondaryEvac'), href: '/secondary-evacuation' },
    {
      label: data?.secondaryWaybillNumber ?? t('traceability.detail.title'),
    },
  ]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) return <ErrorBanner message={error.message ?? String(error)} />;
  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        {t('traceability.detail.notFound')}
      </div>
    );
  }

  const totalKg = data.bagsLoaded * KG_PER_BAG;
  const avgBag = KG_PER_BAG;

  // Column totals for the composition footer row. Purchases + weight are
  // additive across lots; plots/farmers are summed per-lot too (a farmer
  // supplying two primary lots counts under each — the header summary line
  // above carries the deduped unique totals).
  const lotTotals = data.primaryLots.reduce(
    (acc, p) => {
      acc.purchases += p.purchaseCount;
      acc.plots += p.plotCount;
      acc.farmers += p.farmerCount;
      acc.kg += p.kgReceived ?? 0;
      return acc;
    },
    { purchases: 0, plots: 0, farmers: 0, kg: 0 },
  );

  // Expand/collapse state for the lot drilldowns, lifted here so the
  // "Expand all" / "Collapse all" buttons can drive every row at once.
  const expandableKeys = data.primaryLots
    .filter((p) => p.purchases.length > 0)
    .map((p) => p.primaryWaybillRaw);
  const openCount = expandableKeys.filter((k) => open[k]).length;
  const allExpanded = expandableKeys.length > 0 && openCount === expandableKeys.length;
  // Unmatched (unresolved) child purchases + orphan primary waybills
  // across the whole lot — drive the composition-level warning badge.
  const totalUnmatched = data.primaryLots.reduce(
    (n, p) => n + p.purchases.filter((c) => !c.matched).length,
    0,
  );
  const orphanPrimaryCount = data.primaryLots.filter((p) => !p.id).length;
  const unresolvedLabel =
    totalUnmatched > 0 || orphanPrimaryCount > 0
      ? `${t('traceability.detail.composition.unresolvedPrefix')} ${[
          totalUnmatched > 0 &&
            intl.formatMessage(
              { id: 'traceability.detail.composition.unresolvedPurchases' },
              { count: totalUnmatched },
            ),
          orphanPrimaryCount > 0 &&
            intl.formatMessage(
              { id: 'traceability.detail.composition.unresolvedPrimaryWb' },
              { count: orphanPrimaryCount },
            ),
        ]
          .filter(Boolean)
          .join(', ')}`
      : null;
  const expandAll = () => setOpen(Object.fromEntries(expandableKeys.map((k) => [k, true])));
  const collapseAll = () => setOpen({});
  const driverName =
    [data.driverFirstName, data.driverLastName].filter(Boolean).join(' ').trim() || '—';
  // Strip a trailing "warehouse" (slug or plain-text) — the "Warehouse:"
  // label already states the type, so keep just the district name.
  const warehouseLabel = formatLabel(data.depotOrigin.replace(/[\s_]*warehouse\s*$/i, ''));
  // Strip a trailing "port" — the "Port:" label / anchor icon already
  // states the type, so keep just the port name.
  const portLabel = formatLabel(data.portDestination.replace(/[\s_]*port\s*$/i, ''));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/secondary-evacuation" />
          <h1 className="font-semibold text-2xl text-foreground">
            {t('traceability.detail.title')}
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('traceability.detail.subtitle')}</p>
      </header>

      <section className="flex items-start gap-3 rounded-lg border bg-card p-3.5 shadow-sm">
        <StatusTag tone="info" variant="icon">
          <Truck className="size-5" />
        </StatusTag>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono font-semibold text-foreground text-xl">
              {data.secondaryWaybillNumber}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
              <CalendarDays className="size-3" />
              {intl.formatMessage(
                { id: 'traceability.detail.evacuatedAt' },
                { date: data.evacuationDate },
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusTag tone="success">
              <Warehouse className="size-3" />
              {t('traceability.detail.warehouseLabel')} {warehouseLabel}
            </StatusTag>
            <MoveRight className="size-3.5 text-muted-foreground" />
            <StatusTag tone="info">
              <Anchor className="size-3" />
              {t('traceability.detail.portLabel')} {portLabel}
            </StatusTag>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
        <StatTile
          Icon={Package}
          tone="info"
          label={t('traceability.detail.bags')}
          value={data.bagsLoaded.toLocaleString()}
          sub={t('traceability.detail.bagsSub')}
        />
        <StatTile
          Icon={Scale}
          tone="success"
          label={t('traceability.detail.weight')}
          value={`${totalKg.toLocaleString()} kg`}
          sub={t('traceability.detail.weightSub')}
        />
        <StatTile
          Icon={Boxes}
          tone="caution"
          label={t('traceability.detail.avgBag')}
          value={`${avgBag.toFixed(1)} kg`}
          sub={t('traceability.detail.avgBagSub')}
        />
        <StatTile
          Icon={Calendar}
          tone="info2"
          label={t('traceability.detail.evacDate')}
          value={data.evacuationDate}
          sub={t('traceability.detail.evacDateSub')}
        />
      </div>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b p-4">
          <div className="flex items-center gap-2">
            <Layers className="size-4 shrink-0 text-foreground" />
            <h2 className="font-semibold text-base text-foreground">
              {t('traceability.detail.composition.title')}
            </h2>
            {unresolvedLabel && (
              <StatusTag tone="caution" className="ml-auto">
                <TriangleAlert className="size-3" />
                {unresolvedLabel}
              </StatusTag>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {intl.formatMessage(
              { id: 'traceability.detail.composition.summary' },
              {
                wbs: data.custody.totalPrimary,
                purchases: data.chainDepth.purchases,
                farmers: data.linkedFarms.farmers,
                plots: data.linkedFarms.plots,
              },
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[740px]">
            <div
              className={`${LOT_GRID} border-b bg-muted py-2 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide`}
            >
              <span className="sticky left-0 z-20 flex items-center bg-muted pl-4">
                {expandableKeys.length > 0 && (
                  <button
                    type="button"
                    onClick={allExpanded ? collapseAll : expandAll}
                    aria-label={t(
                      allExpanded
                        ? 'traceability.detail.composition.collapseAll'
                        : 'traceability.detail.composition.expandAll',
                    )}
                    className="inline-flex cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {allExpanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </button>
                )}
              </span>
              <span className="sticky left-12 z-10 bg-muted">
                {t('traceability.detail.composition.col.waybill')}
              </span>
              <span>{t('traceability.detail.composition.col.purchases')}</span>
              <span>{t('traceability.detail.composition.col.plots')}</span>
              <span>{t('traceability.detail.composition.col.farmers')}</span>
              <span className="pr-4 text-right">
                {t('traceability.detail.composition.col.weight')}
              </span>
            </div>
            <div className="divide-y">
              {data.primaryLots.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  {t('traceability.detail.composition.empty')}
                </div>
              ) : (
                data.primaryLots.map((p) => (
                  <PrimaryLotRow
                    key={p.primaryWaybillRaw}
                    row={p}
                    expanded={!!open[p.primaryWaybillRaw]}
                    onToggle={() =>
                      setOpen((prev) => ({
                        ...prev,
                        [p.primaryWaybillRaw]: !prev[p.primaryWaybillRaw],
                      }))
                    }
                  />
                ))
              )}
            </div>
            {data.primaryLots.length > 0 && (
              <div
                className={`${LOT_GRID} items-center border-t bg-muted py-2.5 font-semibold text-foreground text-xs`}
              >
                <span className="sticky left-0 z-10 bg-muted pl-4" />
                <span className="sticky left-12 z-10 bg-muted uppercase tracking-wide">
                  {t('traceability.detail.composition.total')}
                </span>
                <span className="text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'traceability.detail.composition.row.purchases' },
                    { count: lotTotals.purchases },
                  )}
                </span>
                <span className="text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'traceability.detail.composition.row.plots' },
                    { count: lotTotals.plots },
                  )}
                </span>
                <span className="text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'traceability.detail.composition.row.farmers' },
                    { count: lotTotals.farmers },
                  )}
                </span>
                <span className="pr-4 text-right text-sm">{fmtKg(lotTotals.kg)}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
          <h2 className="font-semibold text-foreground text-sm">
            {t('traceability.detail.transportTitle')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('traceability.detail.transportSubtitle')}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusTag tone="success">
              <Warehouse className="size-3" />
              {t('traceability.detail.warehouseLabel')} {warehouseLabel}
            </StatusTag>
            <MoveRight className="size-3.5 text-muted-foreground" />
            <StatusTag tone="info">
              <Anchor className="size-3" />
              {t('traceability.detail.portLabel')} {portLabel}
            </StatusTag>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                {t('traceability.detail.driverName')}
              </span>
              <span className="font-medium text-foreground text-sm">{driverName}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                {t('traceability.detail.truck')}
              </span>
              <span className="font-medium font-mono text-foreground text-sm">
                {data.truckRegistration ?? '—'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                {t('traceability.detail.license')}
              </span>
              <span className="font-medium font-mono text-foreground text-sm">
                {data.driverLicenceNumber ?? '—'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                {t('traceability.detail.seal')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-muted-foreground" />
                <span className="font-medium font-mono text-foreground text-sm">
                  {data.sealNumber ?? '—'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({
  Icon,
  tone,
  label,
  value,
  sub,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: StatusTone;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-row-reverse items-start gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <StatusTag tone={tone} variant="icon">
        <Icon className="h-5 w-5" />
      </StatusTag>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span className="font-semibold text-2xl text-foreground">{value}</span>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

function PrimaryLotRow({
  row,
  expanded,
  onToggle,
}: {
  row: ApiTraceabilityPrimaryLotRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const hasDrilldown = row.purchases.length > 0;
  const isOrphan = !row.id;
  const wbLabel = row.primaryWaybillNumber ?? row.primaryWaybillRaw;
  const unmatchedCount = row.purchases.filter((p) => !p.matched).length;
  // Resolved rows first; unresolved ones sink to the bottom.
  const sortedPurchases = [...row.purchases].sort((a, b) => Number(b.matched) - Number(a.matched));

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDrilldown && onToggle()}
        disabled={!hasDrilldown}
        className={`${LOT_GRID} w-full items-center py-3 text-left ${
          hasDrilldown ? 'cursor-pointer hover:bg-muted/40' : ''
        }`}
      >
        <span className="sticky left-0 z-10 flex items-center bg-card pl-4">
          {hasDrilldown ? (
            expanded ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="size-3.5" />
          )}
        </span>
        <span
          className="sticky left-12 z-10 inline-flex min-w-0 max-w-full items-center gap-1.5 bg-card"
          title={wbLabel}
        >
          <StatusTag tone="info" className="max-w-full">
            <span className="min-w-0 truncate font-mono">{wbLabel}</span>
          </StatusTag>
          {isOrphan && (
            <span
              className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
              title={t('traceability.detail.composition.orphanBanner')}
            >
              <TriangleAlert className="size-3.5" />
            </span>
          )}
          {!isOrphan && unmatchedCount > 0 && !expanded && (
            <span
              className="inline-flex shrink-0"
              title={intl.formatMessage(
                { id: 'traceability.detail.composition.unmatchedBanner' },
                { count: unmatchedCount },
              )}
            >
              <StatusTag tone="caution">
                <TriangleAlert className="size-3" />
                {unmatchedCount}
              </StatusTag>
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {row.purchaseCount > 0
            ? intl.formatMessage(
                { id: 'traceability.detail.composition.row.purchases' },
                { count: row.purchaseCount },
              )
            : '—'}
        </span>
        <span className="text-muted-foreground text-xs">
          {row.plotCount > 0
            ? intl.formatMessage(
                { id: 'traceability.detail.composition.row.plots' },
                { count: row.plotCount },
              )
            : '—'}
        </span>
        <span className="text-muted-foreground text-xs">
          {row.farmerCount > 0
            ? intl.formatMessage(
                { id: 'traceability.detail.composition.row.farmers' },
                { count: row.farmerCount },
              )
            : '—'}
        </span>
        <span className="pr-4 text-right font-medium text-foreground text-sm">
          {fmtKg(row.kgReceived)}
        </span>
      </button>

      {expanded && hasDrilldown && (
        <div className="border-t bg-muted/20">
          {/* Inner purchase drilldown — same LOT_GRID so columns line up
              edge-to-edge with the outer lot rows; col1 stays empty as
              the indent + sticky anchor. */}
          <div
            className={`${LOT_GRID} border-b bg-muted py-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide`}
          >
            <span className="sticky left-0 z-10 bg-muted pl-4" />
            <span className="sticky left-12 z-10 bg-muted">
              {t('traceability.detail.composition.col.purchaseId')}
            </span>
            <span>{t('traceability.detail.composition.col.date')}</span>
            <span>{t('traceability.detail.composition.col.plot')}</span>
            <span>{t('traceability.detail.composition.col.farmer')}</span>
            <span className="pr-4 text-right">{t('traceability.detail.composition.col.qty')}</span>
          </div>
          {sortedPurchases.map((p) => (
            <div
              key={p.id}
              className={`${LOT_GRID} items-center border-b bg-card py-1.5 text-xs last:border-b-0`}
            >
              <span className="sticky left-0 z-10 bg-card pl-4" />
              <span className="sticky left-12 z-10 inline-flex min-w-0 items-center gap-1.5 bg-card">
                {p.matched ? (
                  <Link
                    to={`/purchases/${encodeURIComponent(p.purchaseId)}`}
                    className="truncate font-mono text-primary hover:underline"
                  >
                    {p.purchaseId}
                  </Link>
                ) : (
                  <>
                    <span className="truncate font-mono text-muted-foreground">{p.purchaseId}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t('traceability.detail.composition.unmatchedTooltip')}
                          className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
                        >
                          <TriangleAlert className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px]">
                        {t('traceability.detail.composition.unmatchedTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
              </span>
              <span className="text-muted-foreground">{p.purchaseDate ?? '—'}</span>
              <span className="truncate font-mono">
                {p.fieldId ? (
                  <Link to={`/farms/${encodeURIComponent(p.fieldId)}`} className="hover:underline">
                    {p.fieldId}
                  </Link>
                ) : (
                  '—'
                )}
              </span>
              <span className="truncate">{p.farmerName ?? '—'}</span>
              <span className="pr-4 text-right font-semibold">{fmtKg(p.weightKg)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
