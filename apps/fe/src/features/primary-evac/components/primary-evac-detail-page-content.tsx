/**
 * Primary Evacuation Detail — mirrors the Pencil `wqRTA` design.
 *
 * Sections (vertical stack):
 *   1. Hero card  — Waybill # + Source → Destination chips
 *   2. Receipt tiles — Bags · Weight · Avg bag · Evac date, 2-col layout
 *   3. Lot composition table
 *   4. Transport detail
 *
 * All chips + icon holders use the shared `StatusTag`.
 */

import {
  Boxes,
  Calendar,
  CalendarDays,
  CheckCircle2,
  LandPlot,
  Layers,
  Loader2,
  MoveRight,
  Package,
  Scale,
  TriangleAlert,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { useIntl } from 'react-intl';
import { Link, useParams } from 'react-router-dom';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatSociety } from '@/lib/society';
import { usePrimaryEvac } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

function fmtKg(kg: number | null | undefined): string {
  if (kg == null) return '—';
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function formatWarehouse(w: string): string {
  // Return just the district/depot name — the "Warehouse:" label (or the
  // warehouse icon) already conveys the type, so a trailing "Warehouse"
  // in the value would be redundant.
  const name = w
    .replace(/[\s_]*warehouse\s*$/i, '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return name || 'Warehouse';
}

export function PrimaryEvacDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data, isLoading, error } = usePrimaryEvac(id);

  useBreadcrumb([
    { label: t('navigation.primaryEvac'), href: '/primary-evacuation' },
    {
      label: data?.primaryWaybillNumber ?? t('primaryEvac.detail.title'),
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
        {t('primaryEvac.detail.notFound')}
      </div>
    );
  }

  const avgBag = data.bagsReceived > 0 ? data.kgReceived / data.bagsReceived : null;
  const childSum = data.childPurchases.reduce((acc, c) => acc + (c.weightKg ?? 0), 0);
  const matchedSum = data.childPurchases
    .filter((c) => c.matched)
    .reduce((acc, c) => acc + (c.weightKg ?? 0), 0);
  const totalChildren = data.childPurchases.length;
  const matchedChildren = data.childPurchases.filter((c) => c.matched).length;
  const unmatchedChildren = totalChildren - matchedChildren;
  // Resolved rows first; unresolved ones sink to the bottom (they carry
  // no traced fields, so they'd otherwise punch "—" holes mid-table).
  const sortedChildren = [...data.childPurchases].sort(
    (a, b) => Number(b.matched) - Number(a.matched),
  );
  const receiptMatches =
    totalChildren > 0 &&
    matchedSum > 0 &&
    Math.abs(childSum - data.kgReceived) / data.kgReceived < 0.05;

  // formatSociety strips the redundant " Society" suffix — the label
  // already says Society.
  const sourceLabel = formatSociety(data.society);
  const warehouseLabel = formatWarehouse(data.districtWarehouse);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/primary-evacuation" />
          <h1 className="font-semibold text-2xl text-foreground">
            {t('primaryEvac.detail.title')}
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('primaryEvac.detail.subtitle')}</p>
      </header>

      <section className="flex items-start gap-3 rounded-lg border bg-card p-3.5 shadow-sm">
        <StatusTag tone="success" variant="icon">
          <Truck className="size-5" />
        </StatusTag>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono font-semibold text-foreground text-xl">
              {data.primaryWaybillNumber}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
              <CalendarDays className="size-3" />
              {intl.formatMessage(
                { id: 'primaryEvac.detail.evacuatedAt' },
                { date: data.evacuationDate },
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusTag tone="lime">
              <LandPlot className="size-3" />
              {t('primaryEvac.detail.sourceLabel')} {sourceLabel}
            </StatusTag>
            <MoveRight className="size-3.5 text-muted-foreground" />
            <StatusTag tone="success">
              <Warehouse className="size-3" />
              {t('primaryEvac.detail.destLabel')} {warehouseLabel}
            </StatusTag>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
        <Tile
          Icon={Package}
          tone="info"
          label={t('primaryEvac.detail.bags')}
          value={data.bagsReceived.toLocaleString()}
          sub={t('primaryEvac.detail.bagsSub')}
        />
        <Tile
          Icon={Scale}
          tone="success"
          label={t('primaryEvac.detail.weight')}
          value={fmtKg(data.kgReceived)}
          sub="kg received"
        />
        <Tile
          Icon={Boxes}
          tone="caution"
          label={t('primaryEvac.detail.avgBag')}
          value={avgBag ? `${avgBag.toFixed(1)} kg` : '—'}
          sub={t('primaryEvac.detail.avgBagSub')}
        />
        <Tile
          Icon={Calendar}
          tone="info2"
          label={t('primaryEvac.detail.evacDate')}
          value={data.evacuationDate}
          sub={t('primaryEvac.detail.evacDateSub')}
        />
      </div>

      <section className="rounded-lg border bg-card shadow-sm">
        <CardHeader
          Icon={Layers}
          title={t('primaryEvac.detail.compositionTitle')}
          subtitle={intl.formatMessage(
            { id: 'primaryEvac.detail.compositionSubtitle' },
            { total: totalChildren, matched: matchedChildren },
          )}
          action={
            unmatchedChildren > 0 ? (
              <StatusTag tone="caution">
                <TriangleAlert className="size-3" />
                {intl.formatMessage(
                  { id: 'primaryEvac.detail.unresolvedBanner' },
                  { count: unmatchedChildren },
                )}
              </StatusTag>
            ) : receiptMatches ? (
              <StatusTag tone="success">
                <CheckCircle2 className="size-3" />
                {t('primaryEvac.detail.matchesReceipt')}
              </StatusTag>
            ) : null
          }
        />
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[200px_minmax(160px,1fr)_120px_100px_80px] gap-3 border-b bg-muted py-2 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
              <span className="sticky left-0 z-20 bg-muted pl-4">
                {t('primaryEvac.detail.col.purchaseId')}
              </span>
              <span>{t('primaryEvac.detail.col.farmer')}</span>
              <span>{t('primaryEvac.detail.col.plot')}</span>
              <span>{t('primaryEvac.detail.col.date')}</span>
              <span className="pr-4 text-right">{t('primaryEvac.detail.col.kg')}</span>
            </div>
            {totalChildren === 0 ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">
                {t('primaryEvac.detail.compositionEmpty')}
              </div>
            ) : (
              sortedChildren.map((c) => (
                <div
                  key={c.id}
                  className="grid grid-cols-[200px_minmax(160px,1fr)_120px_100px_80px] items-center gap-3 border-b bg-card py-2 text-sm last:border-b-0"
                >
                  <span className="sticky left-0 z-10 inline-flex items-center gap-1.5 bg-card pl-4 font-mono text-primary text-xs">
                    {c.matched && c.purchaseId ? (
                      <Link
                        to={`/purchases/${encodeURIComponent(c.purchaseId)}`}
                        className="truncate hover:underline"
                      >
                        {c.purchaseIdRaw}
                      </Link>
                    ) : (
                      <>
                        <span className="truncate text-muted-foreground">{c.purchaseIdRaw}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={t('primaryEvac.detail.unresolved')}
                              className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
                            >
                              <TriangleAlert className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px]">
                            {t('primaryEvac.detail.unmatchedTooltip')}
                          </TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </span>
                  <span className="truncate">
                    {c.farmerId ? (
                      <Link
                        to={`/farmers/${encodeURIComponent(c.farmerId)}`}
                        className="hover:underline"
                      >
                        {c.farmerName ?? c.farmerCode ?? '—'}
                      </Link>
                    ) : (
                      (c.farmerName ?? c.farmerCode ?? '—')
                    )}
                  </span>
                  <span className="truncate font-mono text-xs">
                    {c.fieldId ? (
                      <Link
                        to={`/farms/${encodeURIComponent(c.fieldId)}`}
                        className="hover:underline"
                      >
                        {c.fieldId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">{c.purchaseDate ?? '—'}</span>
                  <span className="pr-4 text-right font-semibold">{fmtKg(c.weightKg)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-muted-foreground text-xs">
            {intl.formatMessage(
              { id: 'primaryEvac.detail.compositionFooter' },
              { count: totalChildren },
            )}
          </span>
          <span className="font-bold text-foreground text-sm">
            {totalChildren > 0 ? fmtKg(childSum) : '—'}
          </span>
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
          <h2 className="font-semibold text-foreground text-sm">
            {t('primaryEvac.detail.transportTitle')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('primaryEvac.detail.transportSubtitle')}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusTag tone="lime">
              <LandPlot className="size-3" />
              {t('primaryEvac.detail.sourceLabel')} {sourceLabel}
            </StatusTag>
            <MoveRight className="size-3.5 text-muted-foreground" />
            <StatusTag tone="success">
              <Warehouse className="size-3" />
              {t('primaryEvac.detail.destLabel')} {warehouseLabel}
            </StatusTag>
          </div>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                {t('primaryEvac.detail.driverName')}
              </span>
              <span className="font-medium text-foreground text-sm">
                {[data.driverFirstName, data.driverLastName].filter(Boolean).join(' ').trim() ||
                  '—'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                {t('primaryEvac.detail.truck')}
              </span>
              <span className="font-medium font-mono text-foreground text-sm">
                {data.truckRegistration ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Tile({
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

function CardHeader({
  Icon,
  title,
  subtitle,
  action,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-foreground" />
        <h2 className="font-semibold text-base text-foreground">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <p className="text-muted-foreground text-xs">{subtitle}</p>
    </div>
  );
}
