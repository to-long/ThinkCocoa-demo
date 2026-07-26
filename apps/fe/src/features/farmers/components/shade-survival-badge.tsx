/**
 * ShadeSurvivalBadge — StatusTag pill showing a farmer's or parcel's
 * shade tree survival %. Tone thresholds:
 *
 *   ≥ 80  → success (green)   agroforestry canopy healthy
 *   60-79 → caution (yellow)  losses starting to accumulate
 *   40-59 → warning (orange)  significant mortality — needs attention
 *   < 40  → danger  (red)     canopy collapse
 *   null  → em-dash            no shade tree profiles yet
 */

import { StatusTag, type StatusTone } from '@/components/ui/status-tag';

function toneForPct(pct: number): StatusTone {
  if (pct >= 80) return 'success';
  if (pct >= 60) return 'caution';
  if (pct >= 40) return 'warning';
  return 'danger';
}

export function ShadeSurvivalBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(pct * 10) / 10;
  return (
    <StatusTag tone={toneForPct(pct)} dot>
      {rounded}%
    </StatusTag>
  );
}
