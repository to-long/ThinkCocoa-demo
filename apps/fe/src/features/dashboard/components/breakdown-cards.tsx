/**
 * Shared dashboard breakdown cards — a donut variant and a thin-bar
 * variant. Every tab on `/dashboard` renders its charts through these
 * two components so palette, ring thickness, bar thickness, HTML
 * legend, and empty-state affordances stay in lockstep across
 * Farmers / Farms / Traceability / VSLA.
 *
 * Chart.js registration lives in `farmer-stats-section.tsx`; both
 * files run at module load so it doesn't matter which imports which
 * first — the registration is idempotent.
 */

import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { StatusTone } from '@/components/ui/status-tag';

ChartJS.register(
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
);

export interface BreakdownItem {
  label: string;
  count: number;
  /** Optional semantic tone — when set, overrides the fallback palette
   *  index. Use for charts whose slices carry meaning (certification,
   *  consent) so the fill matches the equivalent StatusTag pill. */
  tone?: StatusTone;
  /** Explicit hex color. Only used when neither tone nor palette fits
   *  (e.g. gender's canonical pink/blue split falls outside the tone
   *  palette). Wins over `tone` when both are set. */
  color?: string;
}

/** Solid slice colors picked to match the OVERALL visual weight of a
 *  StatusTag pill — which is dominated by its `bg-{color}-100` fill,
 *  not the -600 dot inside. -400 shades read similarly to the pill
 *  in a chart context. */
export const TONE_HEX: Record<StatusTone, string> = {
  success: '#4ade80', // green-400
  warning: '#fb923c', // orange-400
  caution: '#fbbf24', // amber-400
  danger: '#f87171', // red-400
  info: '#60a5fa', // blue-400
  info2: '#a78bfa', // violet-400
  lime: '#a3e635', // lime-400
  neutral: '#d1d5db', // gray-300
};

/** Fallback palette for BreakdownItems without a tone or color. */
export const DONUT_PALETTE = [
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#a78bfa', // violet-400
  '#22d3ee', // cyan-400
  '#f472b6', // pink-400
  '#a3e635', // lime-400
] as const;

export const OTHER_COLOR = '#cbd5e1'; // slate-300 — muted "Other" bucket
export const BAR_COLOR = '#60a5fa'; // blue-400 — single-hue bar fill

// Axis tick + grid colours for canvas charts. Slate-400 at partial
// opacity stays legible on BOTH the light card and the dark theme —
// the canvas can't read the CSS theme vars, so a neutral mid-grey is
// the safe choice (near-black ticks vanished in dark mode).
const AXIS_TICK_COLOR = 'rgba(148, 163, 184, 0.9)'; // slate-400
const AXIS_GRID_COLOR = 'rgba(148, 163, 184, 0.2)';

function colorFor(it: BreakdownItem, i: number): string {
  if (it.color) return it.color;
  if (it.tone) return TONE_HEX[it.tone];
  return DONUT_PALETTE[i % DONUT_PALETTE.length]!;
}

/**
 * Donut (doughnut) chart card. Zero-count items are pruned before
 * coloring (they produce useless slices and clutter the legend). Items
 * past `sliceLimit` roll up into a single "Other" slice so high-card
 * dimensions stay readable as a proportion instead of turning into
 * confetti.
 */
export function DonutCard({
  title,
  subtitle,
  items,
  sliceLimit,
  footer,
  showEmpty = false,
}: {
  title: string;
  subtitle?: string;
  items: BreakdownItem[];
  sliceLimit?: number;
  footer?: string;
  /** When true, keep zero-count items in the legend (their wedge draws
   *  nothing but the row + color chip stay visible). Use for donuts
   *  whose full status set should always be shown even when some
   *  buckets happen to be empty (certification outcomes). */
  showEmpty?: boolean;
}) {
  const nonZero = showEmpty ? items : items.filter((it) => it.count > 0);

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
      // biome-ignore lint/suspicious/noExplicitAny: chartjs-plugin-datalabels
      // isn't in the local Chart.js type set — cast keeps the option map
      // typed while allowing the plugin key.
      ...({ datalabels: { display: false } } as any),
    },
    // Thin ring — `cutout` accepts absolute pixels. Chart is drawn in
    // a 120px container so inner radius 50px leaves a 10px band.
    cutout: 50,
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>

      {sliced.length === 0 || total === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
            <Doughnut data={chartData} options={chartOptions} />
          </div>
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
 * Thin horizontal bar card — top-N categorical breakdowns (top ports,
 * top warehouses, etc.). Matches DonutCard's card chrome so a tab that
 * mixes donuts and bars still reads as one panel.
 *
 * Bars are 10px thick to match the donut's ring thickness. Labels
 * come from item.label, values from item.count. Colors follow the same
 * tone/color/palette hierarchy as DonutCard so the same slice reads
 * with the same color in either chart type.
 */
export function BarCard({
  title,
  subtitle,
  items,
  emptyLabel,
  sliceLimit = 8,
}: {
  title: string;
  subtitle?: string;
  items: BreakdownItem[];
  emptyLabel?: string;
  /** Top-N bars. Extras drop off (there's no "Other" bar because a
   *  categorical bar's whole point is comparing named categories). */
  sliceLimit?: number;
}) {
  const nonZero = items.filter((it) => it.count > 0);
  const shown = nonZero.slice(0, sliceLimit);

  // Bars default to one shared color — categorical bar charts read
  // faster when every bar is the same hue (length carries the signal,
  // color is just a fill). Per-item tone/color still wins if the
  // caller has semantic slices to distinguish.
  const anyOverride = shown.some((it) => it.color || it.tone);
  const chartData = {
    labels: shown.map((it) => it.label),
    datasets: [
      {
        data: shown.map((it) => it.count),
        backgroundColor: anyOverride ? shown.map((it, i) => colorFor(it, i)) : BAR_COLOR,
        borderRadius: 4,
        barThickness: 10,
      },
    ],
  };

  const chartOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => ` ${ctx.parsed.x}` },
      },
      // biome-ignore lint/suspicious/noExplicitAny: see DonutCard note above.
      ...({ datalabels: { display: false } } as any),
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: AXIS_GRID_COLOR },
        ticks: { font: { size: 10 }, precision: 0, color: AXIS_TICK_COLOR },
      },
      y: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: AXIS_TICK_COLOR },
      },
    },
  };

  // Height scales with bar count so 12 bars don't cram into the same
  // strip as 3. 22px per bar + a bit of padding matches the visual
  // rhythm of DonutCard.
  const chartHeight = Math.max(80, shown.length * 22 + 24);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>

      {shown.length === 0 ? (
        <span className="text-sm text-muted-foreground">{emptyLabel ?? '—'}</span>
      ) : (
        <div style={{ height: chartHeight }}>
          <Bar data={chartData} options={chartOptions} />
        </div>
      )}
    </div>
  );
}

export interface LinePoint {
  /** X-axis tick label (e.g. a short month "Jul 25"). */
  label: string;
  value: number;
}

/**
 * Thin line-chart card — a single time series (e.g. purchases per month).
 * Matches DonutCard / BarCard chrome so a tab mixing chart types still
 * reads as one panel. Emerald line + faint fill, matching the light
 * dashboard look used by the VSLA trend charts.
 */
export function LineCard({
  title,
  subtitle,
  points,
  emptyLabel,
}: {
  title: string;
  subtitle?: string;
  points: LinePoint[];
  emptyLabel?: string;
}) {
  const hasData = points.some((p) => p.value > 0);

  const chartData = {
    labels: points.map((p) => p.label),
    datasets: [
      {
        data: points.map((p) => p.value),
        borderColor: 'rgba(52, 211, 153, 0.9)', // emerald-400
        backgroundColor: 'rgba(52, 211, 153, 0.12)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointHoverRadius: 4,
        pointBackgroundColor: 'rgba(52, 211, 153, 1)',
      },
    ],
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y}` } },
      // biome-ignore lint/suspicious/noExplicitAny: see DonutCard note above.
      ...({ datalabels: { display: false } } as any),
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        // Slate-400 reads on both light and dark backgrounds — the chart
        // is a canvas so it can't inherit the CSS theme vars, and the
        // old near-black ticks vanished in dark mode.
        ticks: { font: { size: 10 }, color: AXIS_TICK_COLOR },
      },
      y: {
        beginAtZero: true,
        grid: { color: AXIS_GRID_COLOR },
        border: { display: false },
        ticks: { font: { size: 10 }, color: AXIS_TICK_COLOR, precision: 0 },
      },
    },
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>

      {points.length === 0 ? (
        <span className="text-sm text-muted-foreground">{emptyLabel ?? '—'}</span>
      ) : (
        <div className="relative h-[180px] w-full">
          <Line data={chartData} options={chartOptions} />
          {!hasData && (
            <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
              {emptyLabel ?? '—'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
