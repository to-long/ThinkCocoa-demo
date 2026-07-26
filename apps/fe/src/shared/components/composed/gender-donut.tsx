/**
 * Shared "gender breakdown" card — a thin SVG donut of male vs female
 * counts with a center total and a two-row legend (count + % of total).
 *
 * Used on the training-session detail (participants) and the VSLA group
 * detail (members). The SVG ring is deliberately thin (strokeWidth 5)
 * to match the other donuts across the app.
 */

import { StatusTag } from '@/components/ui/status-tag';

export function GenderDonut({
  male,
  female,
  malePct,
  femalePct,
  title = 'Gender breakdown',
  subtitle = 'Male / female split of participants',
  centerLabel = 'participants',
}: {
  male: number;
  female: number;
  malePct: number | null;
  femalePct: number | null;
  title?: string;
  subtitle?: string;
  centerLabel?: string;
}) {
  const total = male + female;
  const circumference = 2 * Math.PI * 36; // r=36
  const maleLen = total > 0 ? circumference * (male / total) : 0;

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between p-4 pb-0">
        <div>
          <h2 className="font-semibold text-sm">{title}</h2>
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        </div>
        <StatusTag tone="neutral">{total} total</StatusTag>
      </header>
      <div className="flex flex-col items-center gap-5 p-5">
        {/* Donut */}
        <div className="relative flex h-[160px] w-[160px] items-center justify-center">
          <svg width={160} height={160} viewBox="0 0 80 80" className="-rotate-90 absolute inset-0">
            <title>Gender donut</title>
            <circle cx={40} cy={40} r={36} fill="none" stroke="#f1f5f9" strokeWidth={5} />
            {male > 0 && (
              <circle
                cx={40}
                cy={40}
                r={36}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={5}
                strokeDasharray={`${maleLen} ${circumference}`}
                strokeLinecap="butt"
              />
            )}
            {female > 0 && (
              <circle
                cx={40}
                cy={40}
                r={36}
                fill="none"
                stroke="#f472b6"
                strokeWidth={5}
                strokeDasharray={`${circumference - maleLen} ${circumference}`}
                strokeDashoffset={-maleLen}
                strokeLinecap="butt"
              />
            )}
          </svg>
          <div className="z-10 flex flex-col items-center">
            <span className="font-semibold text-foreground text-3xl">{total}</span>
            <span className="text-muted-foreground text-[10px]">{centerLabel}</span>
          </div>
        </div>
        {/* Legend — below the graph */}
        <div className="flex w-full flex-col gap-3">
          <GenderRow
            color="bg-sky-400"
            label="Male"
            sub={malePct != null ? `${malePct}% of total` : '—'}
            value={String(male)}
          />
          <GenderRow
            color="bg-pink-400"
            label="Female"
            sub={femalePct != null ? `${femalePct}% of total` : '—'}
            value={String(female)}
          />
        </div>
      </div>
    </section>
  );
}

function GenderRow({
  color,
  label,
  sub,
  value,
}: {
  color: string;
  label: string;
  sub: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-2.5 rounded-full ${color}`} aria-hidden />
      <div className="flex flex-1 flex-col">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{sub}</span>
      </div>
      <span className="font-semibold text-foreground text-lg">{value}</span>
    </div>
  );
}
