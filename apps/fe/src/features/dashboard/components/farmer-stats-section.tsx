/**
 * Farmer stats overview — lives on the dashboard farmers tab. Renders a
 * 2×3 grid of breakdown cards (cooperative / certification / consent /
 * district as donuts; tenure / village as 2D bar charts at the bottom).
 *
 * Stats are global (unfiltered) by design: the list page is where admins
 * narrow down to specific rows; the dashboard is where they see the
 * system-level picture.
 *
 * Data comes from `useFarmerFullStats()` — SWR-cached, invalidated by
 * every farmer mutation, and sourced from an LRU-cached BE endpoint.
 *
 * Rendering uses Chart.js via `react-chartjs-2`. Each card lazily mounts
 * a `<Doughnut>` or `<Bar>`; the components are registered at module
 * scope once so every instance shares the same controller/scale set.
 */

import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Doughnut } from 'react-chartjs-2';
import { useIntl } from 'react-intl';
import type { StatusTone } from '@/components/ui/status-tag';
import type { CertOutcomeBucket } from '@/shared/api';
import { useFarmerFullStats, useParcelStats } from '@/shared/api';
import { useClmrsRecords } from '@/shared/api/clmrs';
import { selectActiveCoop, useActiveCoop } from '@/shared/store/useActiveCoop';
import { usePermission } from '@/shared/store/useGlobalState';

// Register Chart.js building blocks once per module load. Doughnut needs
// ArcElement; Bar needs BarElement + both scales. Tooltip + Legend are
// shared plugins — registering them here lets per-card options simply
// toggle them on/off without re-registering. `ChartDataLabels` is opt-
// in per chart (via `plugins.datalabels` in options) so other charts
// don't sprout unwanted labels.
ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels,
);

// Default to labels OFF so only the charts that explicitly opt-in via
// their options render them. Chart.js plugins default to ON once
// registered — without this override every chart in the app would
// suddenly sprout labels, not just the cards below.
ChartJS.defaults.set('plugins.datalabels', { display: false });

export function FarmerStatsSection() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  // Dashboard wants every computed metric — hit the full-stats endpoint.
  // The slim `/stats` variant powers the inline statsRow on the farmer
  // LIST page (Pencil-matched subset).
  const { data: stats } = useFarmerFullStats();
  const { data: parcelStats } = useParcelStats();

  // Certification donut — uses `byCertificationOutcome` (latest-inspection
  // outcome per farmer) rather than the deprecated `raCertified` scalar,
  // which counted `farmers.certification_status = 'rainforest_alliance'`
  // and was showing a single-slice donut because the field is unmigrated
  // legacy data. `byCertificationOutcome` sums to `total` (with `none`
  // catching farmers who haven't been inspected yet) so the slices are
  // meaningful proportions.
  // Outcome → StatusTag tone mirroring the pill colors on the farmer
  // list + inspection detail. Keeps "Certified is green" as a single
  // convention across the app.
  const OUTCOME_TONE: Record<CertOutcomeBucket, StatusTone> = {
    certified: 'success',
    certified_with_ca: 'lime',
    not_certified: 'warning',
    disqualified: 'danger',
    none: 'neutral',
  };
  // Include every outcome bucket even when count is 0 so admins see the
  // full status set on the legend (helpful for demonstrating "nobody
  // disqualified yet" rather than hiding the row entirely). The wheel
  // still renders a zero-degree wedge (invisible) so proportions stay
  // accurate. See `showEmpty` on DonutCard below.
  const CERT_ORDER: CertOutcomeBucket[] = [
    'certified',
    'certified_with_ca',
    'not_certified',
    'disqualified',
    'none',
  ];
  const countByOutcome = new Map(
    stats?.byCertificationOutcome.map((b) => [b.outcome, b.count]) ?? [],
  );
  const certifiedSlices = stats
    ? CERT_ORDER.map((outcome) => ({
        label: t(`farmers.certification.outcome.${outcome}`),
        count: countByOutcome.get(outcome) ?? 0,
        tone: OUTCOME_TONE[outcome],
      }))
    : [];

  // EUDR compliance across the tenant's parcels. Slice ordering
  // mirrors the parcel-list filter dropdown so the legend reads the
  // same left-to-right anywhere in the app.
  const EUDR_ORDER = ['compliant', 'needs_review', 'non_compliant', 'unknown'] as const;
  const EUDR_TONE: Record<(typeof EUDR_ORDER)[number], StatusTone> = {
    compliant: 'success',
    needs_review: 'caution',
    non_compliant: 'danger',
    unknown: 'neutral',
  };
  const eudrSlices = parcelStats
    ? EUDR_ORDER.map((bucket) => ({
        label: t(`farms.eudr.${bucket}`),
        count: parcelStats.eudr[bucket],
        tone: EUDR_TONE[bucket],
      }))
    : [];

  // CLMRS case status across every observed child — derived from the
  // coaching visits carrying a CLMRS verdict (`/api/clmrs-records`),
  // scoped to the active cooperative.
  // Only fetch CLMRS when the user can read it — a farmer:read role without
  // clmrs:read (e.g. Buyer) would otherwise fire a 403 for the CLMRS donut.
  const activeCoop = useActiveCoop(selectActiveCoop);
  const canReadClmrs = usePermission('clmrs:read');
  const { data: clmrsData } = useClmrsRecords(activeCoop?.cooperativeCode ?? null, canReadClmrs);
  const clmrsRecords = clmrsData?.records ?? [];
  const CLMRS_ORDER = ['pending', 'open', 'closed'] as const;
  const CLMRS_TONE: Record<(typeof CLMRS_ORDER)[number], StatusTone> = {
    pending: 'success', // no case yet — nothing to remediate
    open: 'danger',
    closed: 'caution',
  };
  const clmrsCounts: Record<(typeof CLMRS_ORDER)[number], number> = {
    pending: 0,
    open: 0,
    closed: 0,
  };
  for (const r of clmrsRecords) {
    const status = r.case ? r.case.status : 'pending';
    clmrsCounts[status] += 1;
  }
  const clmrsSlices = CLMRS_ORDER.map((bucket) => ({
    label: t(`clmrs.status.${bucket}`),
    count: clmrsCounts[bucket],
    tone: CLMRS_TONE[bucket],
  }));
  return (
    <div className="flex flex-col gap-4">
      {/* Breakdowns — donuts for categorical facets, 2D bar charts at
          the bottom for tenure (ordinal) and village (top-N ranked). */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('farmers.stats.groupBreakdowns')}
        </span>
        {/* Responsive grid:
            - xs (<md): 1 col — every card stacks full-width.
            - md     : 2 cols — donuts pair up.
            - lg+    : 4 cols — four donuts on one row; village card
              breaks out via `col-span-full`. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <DonutCard title={t('farmers.stats.raCertified')} items={certifiedSlices} showEmpty />
          <DonutCard title={t('dashboard.breakdown.eudrTitle')} items={eudrSlices} showEmpty />
          {canReadClmrs && (
            <DonutCard title={t('dashboard.breakdown.clmrsTitle')} items={clmrsSlices} showEmpty />
          )}
          <DonutCard
            title={t('farmers.stats.bySex')}
            // Sex labels are localized (`farmers.sex.*`). Canonical
            // female=pink, male=blue mapping — falls outside the
            // StatusTag tone set, so we pass raw hex overrides.
            items={(stats?.bySex ?? []).map((s) => ({
              label: t(`farmers.sex.${s.sex}`),
              count: s.count,
              color: SEX_COLOR[s.sex] ?? undefined,
            }))}
          />
          {/* By Society — always on its own row (`col-span-full`), full
              width at every breakpoint. Top 24 render as bars, the
              long tail drops into a 4/2/1-col grid below so every
              society is visible in one card. */}
          <div className="col-span-full">
            <VillageBreakdownCard
              title={t('farmers.stats.bySociety')}
              items={(stats?.bySociety ?? []).map((v) => ({
                label: v.society,
                count: v.count,
              }))}
              barLimit={12}
              footer={
                stats && stats.bySociety.length > 0
                  ? intl.formatMessage(
                      { id: 'farmers.stats.societyCount' },
                      { count: stats.bySociety.length },
                    )
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────────────────────

interface BreakdownItem {
  label: string;
  count: number;
  /** Optional semantic tone — when set, overrides the fallback palette
   *  index. Use for donuts whose slices carry meaning (certification,
   *  consent) so the fill matches the equivalent StatusTag pill. */
  tone?: StatusTone;
  /** Explicit hex color. Only used when neither tone nor palette fits
   *  (e.g. gender's canonical pink/blue split falls outside the tone
   *  palette). Wins over `tone` when both are set. */
  color?: string;
}

/**
 * Slice palette — distinct enough to separate adjacent wedges, close
 * enough in saturation that no single slice draws the eye. Last entry
 * is reserved for the rolled-up "Other" bucket so it reads visually
 * muted relative to the named slices.
 */
// Softer -400 shades — same visual weight as the TONE_HEX palette so
// tone-driven and palette-driven donuts read as one family.
const DONUT_PALETTE = [
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#a78bfa', // violet-400
  '#22d3ee', // cyan-400
  '#f472b6', // pink-400
  '#a3e635', // lime-400
] as const;
const OTHER_COLOR = '#cbd5e1'; // slate-300 — visibly muted vs. palette
const BAR_COLOR = '#60a5fa'; // primary bar fill — same blue-400 as donut slice 0

/**
 * StatusTone → hex fill for donut slices. Values match the `dot`
 * background class in `<StatusTag>` (Tailwind's -600 shade, except
 * `caution` which uses -500 like the pill, and `neutral` -500).
 */
// Solid slice colors picked to match the OVERALL visual weight of a
// StatusTag pill — which is dominated by its `bg-{color}-100` fill,
// not the -600 dot inside. Going one step darker than -100 (i.e.
// the -400 shade) reads similarly to the pill in a chart context and
// avoids the "everything is shouting" feel of the -600 dots.
const TONE_HEX: Record<StatusTone, string> = {
  success: '#4ade80', // green-400
  warning: '#fb923c', // orange-400
  caution: '#fbbf24', // amber-400
  danger: '#f87171', // red-400
  info: '#60a5fa', // blue-400
  info2: '#a78bfa', // violet-400
  lime: '#a3e635', // lime-400
  neutral: '#d1d5db', // gray-300 — softer for empty/unknown buckets
};

// Canonical gender colors — no equivalent StatusTag tone, so we bypass
// the tone map and pass raw hex per slice on the sex donut. Shade
// levels mirror TONE_HEX so the palette feels cohesive.
const SEX_COLOR: Record<string, string> = {
  female: '#f472b6', // pink-400
  male: '#60a5fa', // blue-400
  other: '#a78bfa', // violet-400
  unknown: '#d1d5db', // gray-300
};

/**
 * Donut (doughnut) chart card. Zero-count items are pruned before
 * coloring (they produce useless slices and clutter the legend). Items
 * past `sliceLimit` roll up into a single "Other" slice so high-card
 * dimensions stay readable as a proportion instead of turning into
 * confetti.
 */
function DonutCard({
  title,
  items,
  sliceLimit,
  footer,
  showEmpty = false,
}: {
  title: string;
  items: BreakdownItem[];
  sliceLimit?: number;
  footer?: string;
  /** When true, keep zero-count items in the legend (their wedge draws
   *  nothing but the row + color chip stay visible). Use for donuts
   *  whose full status set should always be shown even when some
   *  buckets happen to be empty (certification outcomes). */
  showEmpty?: boolean;
}) {
  // Drop zero-count items before slicing/coloring — they clutter the
  // legend ("Certified 0 (0%)") without adding any visual signal.
  // Opt out via `showEmpty` for donuts whose full status set matters.
  const nonZero = showEmpty ? items : items.filter((it) => it.count > 0);

  // Semantic tone (if provided by the caller) wins over the fallback
  // palette so certification / consent slices match their StatusTag
  // pills; generic breakdowns (village, tenure) still get palette
  // colors indexed by slice position.
  const colorFor = (it: BreakdownItem, i: number): string => {
    if (it.color) return it.color;
    if (it.tone) return TONE_HEX[it.tone];
    return DONUT_PALETTE[i % DONUT_PALETTE.length]!;
  };

  const sliced: (BreakdownItem & { color: string })[] = [];
  if (sliceLimit && nonZero.length > sliceLimit) {
    nonZero.slice(0, sliceLimit).forEach((it, i) => {
      sliced.push({ ...it, color: colorFor(it, i) });
    });
    const rest = nonZero.slice(sliceLimit);
    const otherCount = rest.reduce((s, it) => s + it.count, 0);
    if (otherCount > 0) {
      sliced.push({ label: 'Other', count: otherCount, color: OTHER_COLOR });
    }
  } else {
    nonZero.forEach((it, i) => {
      sliced.push({ ...it, color: colorFor(it, i) });
    });
  }

  const total = sliced.reduce((s, it) => s + it.count, 0);

  const chartData = {
    labels: sliced.map((s) => s.label),
    datasets: [
      {
        data: sliced.map((s) => s.count),
        backgroundColor: sliced.map((s) => s.color),
        borderColor: 'rgba(255,255,255,0.8)',
        borderWidth: 1,
        hoverOffset: 6,
      },
    ],
  };

  const chartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      // Chart.js draws its legend on canvas, which means every label
      // shares a single font. We want mixed styling (bold count, muted
      // %), so the canvas legend is disabled and we render our own
      // HTML legend beside the donut below.
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(ctx) {
            const n = ctx.parsed as number;
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            return ` ${ctx.label}: ${n} - ${pct}%`;
          },
        },
      },
      // In-wedge labels intentionally off — the HTML legend beside the
      // ring already carries count + percentage for each slice.
      datalabels: { display: false },
    },
    // Thin ring — `cutout` accepts absolute pixels. Chart is drawn in
    // a 120px container so inner radius 50px leaves a 10px band.
    cutout: 50,
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-sm font-semibold text-foreground">{title}</span>

      {sliced.length === 0 || total === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        // Stack donut on top, HTML legend below — narrow card columns
        // (one quarter of the dashboard row) don't have horizontal
        // room for the ring + legend side-by-side without squeezing
        // long labels. Vertical stack keeps every entry legible.
        <div className="flex flex-col items-center gap-3">
          <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
            <Doughnut data={chartData} options={chartOptions} />
          </div>
          {/* HTML legend — mixed styling (bold count + muted %) that
              canvas-drawn Chart.js legends can't express. Each row:
              color chip • category • count — pct%. */}
          <ul className="flex w-full min-w-0 flex-col gap-1">
            {sliced.map((s) => {
              const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
              return (
                <li key={s.label} className="flex items-center gap-2 text-[12px]">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground" title={s.label}>
                    {s.label}
                  </span>
                  <span className="shrink-0 font-mono text-foreground">
                    <span className="font-semibold">{s.count}</span>
                    <span className="ml-1 text-muted-foreground">- {pct}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {footer && <span className="text-[11px] text-muted-foreground">{footer}</span>}
    </div>
  );
}

/**
 * Village-specific breakdown card. Top-N items render as a bar chart
 * (same primitive as `BarCard`), remainder drops into a responsive grid
 * of `name - count - pct%` rows so every village is visible in one
 * card without turning the chart into a pixel smear.
 *
 * Layout:
 *   • Top `barLimit` villages → bar chart (re-uses `Bar` config from
 *     `BarCard`, but computes percentages against the FULL item total
 *     so the bars and tail share one denominator — every bar's label
 *     and every list row's `%` use the same base).
 *   • Remaining villages → `ul` with responsive `grid` (1 col mobile,
 *     2 cols md, 4 cols xl) per spec.
 *
 * Kept local to this file — highly specific to the village dimension;
 * reusing `BarCard` would mean adding a "tail renderer" slot that no
 * other card needs.
 */
function VillageBreakdownCard({
  title,
  items,
  barLimit,
  footer,
}: {
  title: string;
  items: BreakdownItem[];
  barLimit: number;
  footer?: string;
}) {
  // Shared denominator: sum across every village (bars + tail).
  // Using per-visible sum would make bars and list rows render
  // different percentage scales — confusing at best, misleading at
  // worst.
  const total = items.reduce((s, it) => s + it.count, 0);
  const barItems = items.slice(0, barLimit);
  const tailItems = items.slice(barLimit);

  const chartData = {
    labels: barItems.map((it) => it.label),
    datasets: [
      {
        data: barItems.map((it) => it.count),
        backgroundColor: BAR_COLOR,
        borderRadius: 4,
        barThickness: 10,
      },
    ],
  };

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 28 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(ctx) {
            const n = ctx.parsed.y ?? 0;
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            return ` ${n} (${pct}%)`;
          },
        },
      },
      datalabels: {
        display: true,
        textAlign: 'center',
        labels: {
          number: {
            anchor: 'end',
            align: 'end',
            offset: 16,
            color: '#0f172a',
            font: { size: 11, weight: 700 },
            formatter: (value: number) => String(value),
          },
          pct: {
            anchor: 'end',
            align: 'end',
            offset: 2,
            color: '#94a3b8',
            font: { size: 10, weight: 400 },
            formatter(value: number) {
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return `${pct}%`;
            },
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.06)' },
        ticks: { font: { size: 10 }, precision: 0 },
      },
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 }, autoSkip: false, maxRotation: 45 },
      },
    },
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-sm font-semibold text-foreground">{title}</span>

      {barItems.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div className="relative" style={{ height: 220 }}>
          <Bar data={chartData} options={chartOptions} />
        </div>
      )}

      {/* Long-tail list. Villages 25+ land here, one row each, in a
          1 / 2 / 4-col responsive grid. Format: `name count - pct%` —
          every column has a fixed width so the name / count / pct
          stack vertically across rows. `tabular-nums` locks digit
          widths so 9, 99, 999 all right-align to the same column. */}
      {tailItems.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-border pt-3 grid-cols-2 xl:grid-cols-4">
          {tailItems.map((it) => {
            const pct = total > 0 ? Math.round((it.count / total) * 100) : 0;
            return (
              <li key={it.label} className="flex items-center gap-1.5 text-[12px]">
                <span className="w-[120px] truncate text-foreground" title={it.label}>
                  {it.label}
                </span>
                <span className="w-8 text-right font-semibold text-foreground tabular-nums">
                  {it.count}
                </span>
                <span className="text-muted-foreground">-</span>
                <span className="w-9 text-right text-muted-foreground tabular-nums">{pct}%</span>
              </li>
            );
          })}
        </ul>
      )}

      {footer && <span className="text-[11px] text-muted-foreground">{footer}</span>}
    </div>
  );
}
