/**
 * VSLA — 12-month trend charts on the group detail page.
 *
 * Two side-by-side charts:
 *   1. Group health — Savings (bars, $ left axis) + Late-loan balance
 *      (bars, $ left axis) + Active members (line, count right axis).
 *      Answers "is the group growing / repaying / attending?"
 *   2. Members composition — Stacked bars of male + female counts.
 *      Answers "is the gender balance shifting month-on-month?"
 *
 * Data window: newest 12 months of `ApiVslaMonthlyReport`, ordered
 * chronologically so the chart reads left-to-right = older-to-newer.
 * Fewer than 12 rows shows what exists; zero rows hides the section.
 *
 * Chart.js registration is idempotent — the VSLA detail page already
 * calls `ChartJS.register(...)` for bar+line, so this component only
 * needs to import the components + options types.
 */

import {
  BarController,
  BarElement,
  CategoryScale,
  type ChartData,
  Chart as ChartJS,
  type ChartOptions,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { useIntl } from 'react-intl';
import type { ApiVslaMonthlyReport } from '@/shared/api/vsla';
import { GenderDonut } from '@/shared/components/composed/gender-donut';
import { useAppTheme } from '@/shared/hooks/use-app-theme';

// The generic <Chart> (unlike <Line>/<Bar>) does NOT auto-register its
// controllers — they must be registered explicitly, else a cold load of
// this page throws `"line" is not a registered controller`.
ChartJS.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

interface Props {
  reports: ApiVslaMonthlyReport[];
}

function shortMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short' });
}

/** Build a chronological array of the last N months ending at the
 *  anchor (inclusive), each stamped `YYYY-MM`. Used to guarantee
 *  the trend chart always renders a full 12-column grid even when
 *  the group has fewer than 12 reports so a partly-filled group is
 *  visibly "still being tracked" instead of a lonely single bar.
 *
 *  Keys are month-precision (`YYYY-MM`, no day) so they line up with
 *  `reportMonth` regardless of which day the report date falls on —
 *  reports are stamped end-of-month (`2026-05-31`), so a `-01` key
 *  would never match and the series would read as a flat zero line. */
function last12Months(anchor: Date): string[] {
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Month-precision key (`YYYY-MM`) for a report's date, so chart-grid
 *  months match the report regardless of the day component. */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function VslaTrends({ reports }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  // Theme-aware axis colours — the hardcoded near-black ticks/grid were
  // invisible on the dark-theme canvas (Chart.js can't read CSS vars).
  const { isDark } = useAppTheme();
  const tickColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

  // Always render a 12-column grid so the chart looks "in progress"
  // even when the group has fewer than 12 reports. The anchor is the
  // group's newest report month, so a group whose most-recent report
  // is 2026-06 renders Jul '25 → Jun '26.
  if (reports.length === 0) return null;
  const latest = reports[0]!; // BE returns newest-first
  const [ay, am] = latest.reportMonth.split('-');
  const anchor = new Date(Number(ay), Number(am) - 1, 1);
  const monthKeys = last12Months(anchor);

  // Index reports by their month-precision key for O(1) lookup when
  // filling slots (report dates are end-of-month, grid keys are `YYYY-MM`).
  const byMonth = new Map(reports.map((r) => [monthKey(r.reportMonth), r]));

  const labels = monthKeys.map(shortMonth);
  const savings = monthKeys.map((k) => byMonth.get(k)?.savingsCumulative ?? 0);
  const latestMale = latest.maleMembers ?? 0;
  const latestFemale = latest.femaleMembers ?? 0;
  const latestTotal = latestMale + latestFemale;

  // ── Chart 1: cumulative savings per month (single-series bars).
  const savingsData: ChartData<'line', number[], string> = {
    labels,
    datasets: [
      {
        type: 'line',
        label: t('vsla.detail.savingsCumulative'),
        data: savings,
        // Thin emerald-400 line with a faint fill — matches the light
        // dashboard look.
        borderColor: 'rgba(52, 211, 153, 0.9)',
        backgroundColor: 'rgba(52, 211, 153, 0.12)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointHoverRadius: 4,
        pointBackgroundColor: 'rgba(52, 211, 153, 1)',
        spanGaps: true,
      },
    ],
  };
  const savingsOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            return v == null ? '—' : `$${v.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { font: { size: 10 }, color: tickColor },
      },
      y: {
        beginAtZero: true,
        title: { display: true, text: '$ USD', font: { size: 10 }, color: tickColor },
        grid: { color: gridColor },
        border: { display: false },
        ticks: {
          font: { size: 10 },
          color: tickColor,
          callback: (v) => {
            const n = Number(v);
            if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
            return `$${n}`;
          },
        },
      },
    },
  };

  // Latest-month male/female ratio for the shared gender donut.
  const malePct = latestTotal > 0 ? (latestMale / latestTotal) * 100 : 0;
  const femalePct = latestTotal > 0 ? (latestFemale / latestTotal) * 100 : 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Card 1 — cumulative savings line */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-1 p-4 pb-0">
          <h2 className="font-semibold text-base text-foreground">
            {t('vsla.trends.savingsPerMonth')}
          </h2>
          <p className="text-muted-foreground text-xs">{t('vsla.trends.savingsPerMonthDesc')}</p>
        </div>
        <div className="p-4">
          <div className="relative h-[260px] w-full">
            <Chart type="line" data={savingsData} options={savingsOptions} />
          </div>
        </div>
      </section>

      {/* Card 2 — members mix (shared gender-breakdown donut) */}
      <GenderDonut
        male={latestMale}
        female={latestFemale}
        malePct={latestTotal > 0 ? Math.round(malePct) : null}
        femalePct={latestTotal > 0 ? Math.round(femalePct) : null}
        title={intl.formatMessage(
          { id: 'vsla.trends.membersMix' },
          { month: shortMonth(latest.reportMonth) },
        )}
        subtitle={t('vsla.trends.membersMixDesc')}
        centerLabel={t('vsla.detail.activeMembers')}
      />
    </div>
  );
}
