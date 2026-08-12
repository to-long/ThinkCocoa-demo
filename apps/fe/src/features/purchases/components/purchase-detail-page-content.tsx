/**
 * Purchase Detail — mirrors the Pencil `uvT3z` design.
 *
 * Sections:
 *   1. Hero — purchase ID + Payment chip + weight/price inline meta + date
 *   2. Stats tiles — Weight · Amount · Implied rate · Payment (4-up grid)
 *   3. 2-col: Farmer & plot | Buying station (PC level)
 *
 * All chips + icon holders use the shared `StatusTag` so palette + shape
 * match the rest of the app.
 */

import {
  Banknote,
  Calendar,
  CreditCard,
  ExternalLink,
  Loader2,
  Percent,
  Scale,
  ShoppingCart,
  Smartphone,
  Store,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router-dom';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { formatSociety } from '@/lib/society';
import { type PaymentType, usePurchase } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

const PAYMENT_CHIP: Record<
  PaymentType,
  { tone: StatusTone; Icon: typeof Banknote; labelKey: string }
> = {
  cash: { tone: 'success', Icon: Banknote, labelKey: 'purchases.payment.cash' },
  mobile_money: { tone: 'info', Icon: Smartphone, labelKey: 'purchases.payment.mobile_money' },
  cheque: { tone: 'caution', Icon: CreditCard, labelKey: 'purchases.payment.cheque' },
  card: { tone: 'neutral', Icon: CreditCard, labelKey: 'purchases.payment.card' },
};

function fmtMoney(usd: number): string {
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtKg(kg: number): string {
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

export function PurchaseDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data, isLoading, error } = usePurchase(id);

  useBreadcrumb([
    { label: t('navigation.purchases'), href: '/purchases' },
    { label: data?.purchaseId ?? t('purchases.detail.title') },
  ]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <ErrorBanner message={error.message ?? String(error)} />;
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        {t('purchases.detail.notFound')}
      </div>
    );
  }

  const chip = PAYMENT_CHIP[data.paymentType];
  const ChipIcon = chip.Icon;
  const impliedRate = data.weightKg > 0 ? data.amountReceived / data.weightKg : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/purchases" />
          <h1 className="font-semibold text-2xl text-foreground">{t('purchases.detail.title')}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('purchases.detail.subtitle')}</p>
      </header>

      <section className="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
        <StatusTag tone="success" variant="icon">
          <ShoppingCart className="size-5" />
        </StatusTag>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-base text-foreground">
              {data.purchaseId}
            </span>
            <StatusTag tone={chip.tone}>
              <ChipIcon className="size-3" />
              {t(chip.labelKey)}
            </StatusTag>
            {data.isOrphan && (
              <StatusTag tone="caution">{t('purchases.detail.orphanChip')}</StatusTag>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <Calendar className="size-3" />
              {intl.formatMessage(
                { id: 'purchases.detail.purchasedOn' },
                { date: data.purchaseDate },
              )}
            </span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          Icon={Scale}
          tone="info"
          label={t('purchases.detail.weight')}
          value={fmtKg(data.weightKg)}
          sub={t('purchases.detail.weightSub')}
        />
        <StatTile
          Icon={Banknote}
          tone="success"
          label={t('purchases.detail.amount')}
          value={fmtMoney(data.amountReceived)}
          sub={t('purchases.detail.amountSub')}
        />
        <StatTile
          Icon={Percent}
          tone="caution"
          label={t('purchases.detail.impliedRate')}
          value={impliedRate ? `$${impliedRate.toFixed(2)}` : '—'}
          sub={t('purchases.detail.impliedRateSub')}
        />
        <div className="flex flex-row-reverse items-start gap-3 rounded-lg border bg-card p-4 shadow-sm">
          <StatusTag tone="info2" variant="icon">
            <Wallet className="h-5 w-5" />
          </StatusTag>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
              {t('purchases.detail.payment')}
            </span>
            <StatusTag tone={chip.tone}>
              <ChipIcon className="size-3" />
              {t(chip.labelKey)}
            </StatusTag>
            <span className="text-[11px] text-muted-foreground">
              {data.paymentReference ? (
                <span className="font-mono">{data.paymentReference}</span>
              ) : (
                t('purchases.detail.noReference')
              )}
            </span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card shadow-sm">
          <CardHeader
            Icon={UserRound}
            title={t('purchases.detail.farmerTitle')}
            subtitle={t('purchases.detail.farmerSubtitle')}
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 pb-4 sm:grid-cols-2">
            <KV label={t('purchases.detail.farmerName')} value={data.farmerName ?? '—'} />
            <KV
              label={t('purchases.detail.farmerCode')}
              value={data.farmerCode}
              mono
              href={data.farmerCode ? `/farmers/${encodeURIComponent(data.farmerCode)}` : undefined}
            />
            <KV
              label={t('purchases.detail.purchasingClerkCard')}
              value={data.purchasingClerkCardNumber ?? t('purchases.detail.notProvided')}
              mono={!!data.purchasingClerkCardNumber}
              sideNote={t('purchases.detail.optional')}
            />
            <KV
              label={t('purchases.detail.parcelId')}
              value={data.fieldId ?? '—'}
              mono={!!data.fieldId}
              href={data.fieldId ? `/farms/${encodeURIComponent(data.fieldId)}` : undefined}
            />
            <KV label={t('purchases.detail.purchaseDate')} value={data.purchaseDate} />
          </div>
        </section>

        <section className="rounded-lg border bg-card shadow-sm">
          <CardHeader
            Icon={Store}
            title={t('purchases.detail.stationTitle')}
            subtitle={t('purchases.detail.stationSubtitle')}
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 pb-4 sm:grid-cols-2">
            <KV label={t('purchases.detail.stationMark')} value={data.stationMarkNumber} mono />
            <KV label={t('purchases.detail.pcName')} value={data.pcName} />
            <KV label={t('purchases.detail.society')} value={formatSociety(data.society)} />
            <KV label={t('purchases.detail.district')} value={data.district} />
            <KV
              label={t('purchases.detail.cooperative')}
              value={
                data.cooperativeName && data.cooperativeCode
                  ? `${data.cooperativeName} · ${data.cooperativeCode}`
                  : (data.cooperativeName ?? data.cooperativeCode)
              }
            />
          </div>
        </section>
      </div>
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

function CardHeader({
  Icon,
  title,
  subtitle,
}: {
  Icon: typeof Store;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-foreground" />
        <h2 className="font-semibold text-base text-foreground">{title}</h2>
      </div>
      <p className="text-muted-foreground text-xs">{subtitle}</p>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  href,
  sideNote,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  href?: string;
  sideNote?: string;
}) {
  const display = value ?? '—';
  const valueEl = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
    >
      {display}
      <ExternalLink className="size-3 shrink-0" />
    </a>
  ) : (
    <span>{display}</span>
  );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      <div className={`break-all text-foreground text-sm ${mono ? 'font-mono' : ''}`}>
        {valueEl}
        {sideNote && <span className="ml-2 text-muted-foreground text-xs">{sideNote}</span>}
      </div>
    </div>
  );
}
