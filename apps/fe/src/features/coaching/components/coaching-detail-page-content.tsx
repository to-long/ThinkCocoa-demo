/**
 * Farmer Coaching detail — mirrors Pencil `P7q2V`.
 *
 * Sections:
 *   1. Header (title + meta + actions)
 *   2. Risk banner (yellow when at-risk, red when child labour case)
 *   3. 4 KPI tiles: GAP / IPM / GEP / CLMRS
 *   4. Two-column body:
 *      • leftCol — Farm profile (Section A) +
 *                   Activity log (Sections B–G, repeat groups) +
 *                   CLMRS panel (Section H — 3 subgroups)
 *      • sidebar — Coach card · Follow-up card · Compliance flags ·
 *                   Section P observations + Section Q sign-off
 *
 * All section content is parsed inline from `rawData` since the DB
 * stores everything in JSONB. The denorm columns are used for the
 * tiles + banner only.
 */

import {
  ArrowLeft,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  Leaf,
  ListChecks,
  Loader2,
  MapPin,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SprayCan,
  Sprout,
  SquareArrowOutUpRight,
  TreePine,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { CorrectiveActionsCard } from '@/features/inspections/components/corrective-actions-card';
import { formatSociety } from '@/lib/society';
import { useCoachingVisit } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { type ActivityKind, CoachingActivityDrawer } from './coaching-activity-drawer';

interface Props {
  id: string;
}

/** Read a Kobo field accepting multiple key variants (mirror of the
 *  BE parser fallback). Older form versions used bare keys; newer
 *  ones nest under `sec_h/sec_h_xxx`. */
function pick(raw: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!raw) return null;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function arr(
  raw: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown>[] {
  const v = raw?.[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

type FlagStatus = 'ok' | 'bad' | 'unknown';

/** Tri-state compliance flag. A field that wasn't captured (null/empty) is
 *  'unknown' — rendered gray, NEVER as a red violation. Only a real answer
 *  that misses the good value is 'bad'. */
function flagStatus(value: string | null, goodValue: string): FlagStatus {
  if (value == null || value === '') return 'unknown';
  return value === goodValue ? 'ok' : 'bad';
}

export function CoachingDetailPageContent({ id }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();

  const { data: visit, isLoading, error } = useCoachingVisit(id);

  useBreadcrumb([
    { label: t('navigation.coaching'), href: '/coaching' },
    { label: visit?.farmerName ?? visit?.farmerCode ?? id.slice(0, 8) },
  ]);

  // Derived values from raw_data
  const farm = useMemo(() => {
    if (!visit) return null;
    const raw = visit.rawData ?? {};
    return {
      farmSize: pick(raw, 'sec_a/farm_size_ha', 'farm_size_ha'),
      numPlots: pick(raw, 'sec_a/num_plots', 'num_plots'),
      avgTreeAge: pick(raw, 'sec_a/avg_tree_age', 'avg_tree_age'),
      gps: pick(raw, 'sec_a/gps_plot', 'gps_plot'),
      farmName: pick(raw, 'sec_a/farm_name', 'farm_name'),
    };
  }, [visit]);

  const sectionP = useMemo(() => {
    if (!visit) return null;
    const raw = visit.rawData ?? {};
    return {
      condition: pick(raw, 'sec_p/obs_farm_condition'),
      nonCompliance: pick(raw, 'sec_p/obs_non_compliance'),
      advice: pick(raw, 'sec_p/obs_advice_given'),
    };
  }, [visit]);

  const sectionQ = useMemo(() => {
    if (!visit) return null;
    const raw = visit.rawData ?? {};
    return {
      goodPractices: pick(raw, 'sec_q/sum_good_practices'),
      gaps: pick(raw, 'sec_q/sum_gaps'),
      coachingAdvice: pick(raw, 'sec_q/sum_coaching_advice'),
      coachSignoff: pick(raw, 'sec_q/sum_coach_signoff'),
      farmerSignoff: pick(raw, 'sec_q/sum_farmer_signoff'),
    };
  }, [visit]);

  const activities = useMemo(() => {
    if (!visit) return [];
    const raw = visit.rawData ?? {};
    type Activity = {
      key: string;
      kind: ActivityKind;
      sectionLabel: string;
      label: string;
      date: string | null;
      summary: string;
      icon: typeof SprayCan;
      tone: StatusTone;
      raw: Record<string, unknown>;
    };
    const out: Activity[] = [];

    for (const row of arr(raw, 'sec_b')) {
      out.push({
        key: `b${out.length}`,
        kind: 'chemical',
        sectionLabel: 'Section B',
        label: 'Chemical',
        date: pick(row, 'sec_b/chem_app_date'),
        summary: [
          pick(row, 'sec_b/chem_product') ?? '—',
          pick(row, 'sec_b/chem_type'),
          [pick(row, 'sec_b/chem_quantity'), pick(row, 'sec_b/chem_unit')]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join(' · '),
        icon: SprayCan,
        tone: 'info',
        raw: row,
      });
    }
    for (const row of arr(raw, 'sec_c')) {
      out.push({
        key: `c${out.length}`,
        kind: 'fertilizer',
        sectionLabel: 'Section C',
        label: 'Fertilizer',
        date: pick(row, 'sec_c/fert_app_date'),
        summary: [
          pick(row, 'sec_c/fert_product') ?? '—',
          pick(row, 'sec_c/fert_type'),
          [pick(row, 'sec_c/fert_quantity'), pick(row, 'sec_c/fert_unit')]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join(' · '),
        icon: Sprout,
        tone: 'success',
        raw: row,
      });
    }
    for (const row of arr(raw, 'sec_d')) {
      out.push({
        key: `d${out.length}`,
        kind: 'weeding',
        sectionLabel: 'Section D',
        label: 'Weeding',
        date: pick(row, 'sec_d/weed_date'),
        summary: [
          pick(row, 'sec_d/weed_method'),
          `pressure ${pick(row, 'sec_d/weed_pressure') ?? '—'}`,
        ].join(' · '),
        icon: Leaf,
        tone: 'caution',
        raw: row,
      });
    }
    for (const row of arr(raw, 'sec_e')) {
      out.push({
        key: `e${out.length}`,
        kind: 'pruning',
        sectionLabel: 'Section E',
        label: 'Pruning',
        date: pick(row, 'sec_e/prune_date'),
        summary: [
          pick(row, 'sec_e/prune_type'),
          `quality ${pick(row, 'sec_e/prune_quality') ?? '—'}`,
        ].join(' · '),
        icon: TreePine,
        tone: 'info2',
        raw: row,
      });
    }
    for (const row of arr(raw, 'sec_f')) {
      out.push({
        key: `f${out.length}`,
        kind: 'harvest',
        sectionLabel: 'Section F',
        label: 'Harvest',
        date: null,
        summary: [
          pick(row, 'sec_f/harvest_period'),
          pick(row, 'sec_f/harvest_freq'),
          pick(row, 'sec_f/harvest_maturity'),
        ]
          .filter(Boolean)
          .join(' · '),
        icon: ClipboardCheck,
        tone: 'warning',
        raw: row,
      });
    }
    for (const row of arr(raw, 'sec_g')) {
      out.push({
        key: `g${out.length}`,
        kind: 'other',
        sectionLabel: 'Section G',
        label: 'Other',
        date: pick(row, 'sec_g/other_activity_date'),
        summary: [pick(row, 'sec_g/other_activity_type'), pick(row, 'sec_g/other_materials')]
          .filter(Boolean)
          .join(' · '),
        icon: FileText,
        tone: 'neutral',
        raw: row,
      });
    }
    return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [visit]);

  // Selected activity row → opens the drawer. Keyed by index so the
  // prev/next buttons can step through the sorted list.
  const [activityIndex, setActivityIndex] = useState<number | null>(null);
  const selectedActivity =
    activityIndex != null && activityIndex >= 0 && activityIndex < activities.length
      ? activities[activityIndex]!
      : null;

  const flags = useMemo(() => {
    if (!visit) return [];
    const raw = visit.rawData ?? {};
    return [
      {
        label: 'No deforestation since Dec 2020',
        status: flagStatus(pick(raw, 'sec_k/gep_deforestation'), 'no'),
      },
      {
        label: 'Approved chemicals only',
        status: flagStatus(pick(raw, 'sec_j/ipm_approved'), 'yes'),
      },
      { label: 'PPE used', status: flagStatus(pick(raw, 'sec_j/ipm_ppe'), 'yes') },
      {
        label: 'Chemicals stored safely',
        status: flagStatus(pick(raw, 'sec_j/ipm_storage'), 'yes'),
      },
      {
        label: 'Buffer zone respected',
        status: flagStatus(pick(raw, 'sec_k/gep_buffer_zone'), 'yes'),
      },
      { label: 'Workers paid fairly', status: flagStatus(pick(raw, 'sec_l/gsp_fair_pay'), 'yes') },
      {
        label: 'No sign of forced labour',
        status: flagStatus(pick(raw, 'sec_l/gsp_forced_labour'), 'no'),
      },
      {
        label: 'Good agricultural practices',
        status: flagStatus(pick(raw, 'sec_i/gap_practices'), 'yes'),
      },
    ];
  }, [visit]);

  // Passing count for the summary tile (e.g. "8/8"). 'unknown' (field not
  // captured) does not count as passing.
  const flagsPassed = flags.filter((f) => f.status === 'ok').length;

  if (isLoading || (!visit && !error)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !visit) {
    return (
      <div className="flex flex-col items-center gap-4 p-12 text-center">
        <h2 className="font-semibold text-xl">{t('coaching.detail.notFound')}</h2>
        <Button variant="outline" onClick={() => navigate('/coaching')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('coaching.detail.back')}
        </Button>
      </div>
    );
  }

  const raw = visit.rawData ?? {};
  const riskLevel = visit.clmrsRiskLevel ?? 'no_risk';
  const isCase = riskLevel === 'case';
  const isAtRisk = riskLevel === 'at_risk';
  const observedWorking =
    pick(
      raw,
      'sec_h_observation/cl_obs_child_working',
      'sec_h/sec_h_observation/cl_obs_child_working',
    ) === 'yes';

  const riskTile = {
    no_risk: { label: 'No risk', iconClass: 'bg-green-50 text-green-700' },
    at_risk: { label: 'At risk', iconClass: 'bg-amber-50 text-amber-700' },
    case: { label: 'Child labour case', iconClass: 'bg-red-50 text-red-700' },
  }[riskLevel];

  const tiles: { label: string; value: string; icon: typeof SprayCan; iconClass: string }[] = [
    {
      label: 'Activities',
      value: String(activities.length),
      icon: ListChecks,
      iconClass: 'bg-sky-50 text-sky-700',
    },
    {
      label: 'CLMRS assessment',
      value: riskTile.label,
      icon: ShieldAlert,
      iconClass: riskTile.iconClass,
    },
    {
      label: 'Compliance flags',
      value: `${flagsPassed}/${flags.length}`,
      icon: ShieldCheck,
      iconClass:
        flagsPassed === flags.length
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-amber-50 text-amber-700',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Page title — BackButton + title + subtitle, matching the
          training-detail header shape. */}
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/coaching" />
          <h1 className="font-semibold text-2xl text-foreground">{t('coaching.detail.title')}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('coaching.detail.subtitle')}</p>
      </header>

      {/* Hero card — icon + farmer name + code, with the visit meta
          (date · coach · society · farm) as tidy tags on a second row.
          Mirrors the training-detail profile card. */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <StatusTag tone="success" variant="icon">
          <Sprout className="size-5" />
        </StatusTag>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-semibold text-base text-foreground">
              {visit.farmerName ?? visit.farmerCode ?? '—'}
            </span>
            {visit.farmerName && visit.farmerCode && (
              <StatusTag tone="neutral">
                <span className="font-mono">{visit.farmerCode}</span>
              </StatusTag>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
            <span className="inline-flex items-center gap-1">
              <CalendarCheck className="size-3.5" />
              {visit.visitDate}
            </span>
            {visit.society && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {formatSociety(visit.society)}
              </span>
            )}
            {farm?.farmName && (
              <span className="inline-flex items-center gap-1">
                <Leaf className="size-3.5" />
                {farm.farmName}
                {farm.farmSize && ` · ${farm.farmSize} ha`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI tiles — Follow-up schedule + the 3 practice scores */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-start justify-between rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">Follow-up</span>
            <span className="font-semibold text-foreground text-xl">
              {visit.followUpRequired ? (visit.followUpDate ?? 'Scheduled') : 'Not required'}
            </span>
          </div>
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              visit.followUpRequired ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'
            }`}
            aria-hidden
          >
            <CalendarCheck className="h-5 w-5" />
          </span>
        </div>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="flex items-start justify-between rounded-lg border bg-card p-4 shadow-sm"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                {tile.label}
              </span>
              <span className="font-semibold text-foreground text-xl capitalize">{tile.value}</span>
            </div>
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tile.iconClass}`}
              aria-hidden
            >
              <tile.icon className="h-5 w-5" />
            </span>
          </div>
        ))}
      </div>

      {/* Body — single column of stacked rows */}
      <div className="flex flex-col gap-4">
        {/* Corrective actions raised by this visit's non-compliance
            (Section P) — pinned to the top so the action item is the
            first thing staff see. Renders nothing when there are none. */}
        <CorrectiveActionsCard items={visit.followUps} />

        {/* CLMRS risk banner — sits directly below the corrective actions. */}
        {(isAtRisk || isCase || observedWorking) && (
          <div
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              isCase ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'
            }`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-md text-white ${
                isCase ? 'bg-red-500' : 'bg-yellow-500'
              }`}
            >
              <TriangleAlert className="h-4 w-4" />
            </span>
            <div className="flex flex-1 flex-col">
              <span
                className={`font-semibold text-sm ${isCase ? 'text-red-800' : 'text-yellow-800'}`}
              >
                {isCase
                  ? 'Child labour case opened — immediate action required'
                  : 'At-risk household — flagged during enumerator observation'}
              </span>
              <span className="text-muted-foreground text-xs">
                {observedWorking
                  ? 'Children observed working on the farm during this visit'
                  : 'Household risk indicators triggered during CLMRS assessment'}
              </span>
            </div>
          </div>
        )}

        {/* Farm profile (Section A) */}
        <section className="rounded-lg border bg-card">
          <header className="px-4 pt-4 pb-2">
            <h2 className="flex items-center gap-2 font-semibold text-sm">
              <Sprout className="size-4 text-muted-foreground" />
              Farm profile
            </h2>
          </header>
          <div className="px-4 pb-4">
            {/* Farm attributes */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <FieldRow label="Farmer name" value={visit.farmerName ?? '—'} />
              <FieldRow
                label="Farmer Code (ID)"
                value={
                  visit.farmerCode ? (
                    <Link
                      to={`/farmers/${encodeURIComponent(visit.farmerCode)}`}
                      className="inline-flex items-center gap-1 font-mono text-foreground hover:underline"
                    >
                      {visit.farmerCode}
                      <SquareArrowOutUpRight className="size-3.5 text-muted-foreground" />
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <FieldRow label="Parcel name" value={visit.parcelName ?? '—'} />
              <FieldRow
                label="Parcel code (ID)"
                value={
                  visit.parcelId ? (
                    <Link
                      to={`/farms/${encodeURIComponent(visit.parcelId)}`}
                      className="inline-flex items-center gap-1 font-mono text-foreground hover:underline"
                    >
                      {visit.parcelId}
                      <SquareArrowOutUpRight className="size-3.5 text-muted-foreground" />
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <FieldRow label="Farm size" value={farm?.farmSize ? `${farm.farmSize} ha` : '—'} />
              <FieldRow label="Number of plots" value={farm?.numPlots ?? '—'} />
              <FieldRow
                label="Average tree age"
                value={farm?.avgTreeAge ? `${farm.avgTreeAge} years` : '—'}
              />
              <FieldRow label="Farm name" value={farm?.farmName ?? '—'} />
              <FieldRow
                label="GPS"
                value={farm?.gps ? farm.gps.split(' ').slice(0, 2).join(', ') : '—'}
                mono
              />
            </div>
            {/* Practice scores below the divider */}
            <div className="my-4 border-border border-t" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <FieldRow
                label="GAP score"
                value={visit.gapScore != null ? `${visit.gapScore}%` : '—'}
              />
              <FieldRow
                label="IPM score"
                value={visit.ipmScore != null ? `${visit.ipmScore}%` : '—'}
              />
              <FieldRow
                label="GEP score"
                value={visit.gepScore != null ? `${visit.gepScore}%` : '—'}
              />
              <FieldRow
                label="GSP score"
                value={visit.gspScore != null ? `${visit.gspScore}%` : '—'}
              />
            </div>
          </div>
        </section>

        {/* Coach + Compliance flags — side by side directly under Farm profile */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Coach card — identity + coaching notes consolidated into a
              single card, mirroring the training-detail Trainer card. */}
          <section className="rounded-lg border bg-card">
            <header className="p-4 pb-0">
              <h2 className="flex items-center gap-2 font-semibold text-sm">
                <User className="size-4 text-muted-foreground" />
                Coach
              </h2>
            </header>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
              <FieldRow label="Name" value={visit.coachName ?? '—'} />
              {sectionP?.condition && (
                <FieldRow
                  label="Farm condition"
                  value={<span className="capitalize">{sectionP.condition}</span>}
                />
              )}
              {sectionQ?.coachSignoff && (
                <FieldRow label="Coach sign-off" value={sectionQ.coachSignoff} />
              )}
              {sectionQ?.farmerSignoff && (
                <FieldRow label="Farmer sign-off" value={sectionQ.farmerSignoff} />
              )}
            </div>
            {(sectionP?.advice ||
              (sectionQ?.coachingAdvice && sectionQ.coachingAdvice !== sectionP?.advice)) && (
              <div className="px-4 pb-4">
                <span className="mb-1 block text-muted-foreground text-[11px] uppercase tracking-wide">
                  Coach comment
                </span>
                {sectionP?.advice && (
                  <p className="border-l-2 pl-2 text-muted-foreground text-xs italic">
                    "{sectionP.advice}"
                  </p>
                )}
                {sectionQ?.coachingAdvice && sectionQ.coachingAdvice !== sectionP?.advice && (
                  <p className="mt-1 border-l-2 pl-2 text-muted-foreground text-xs italic">
                    "{sectionQ.coachingAdvice}"
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Compliance flags */}
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-sm">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Compliance flags
            </h2>
            <ul className="flex flex-col gap-1.5">
              {flags.map((f) => (
                <li key={f.label} className="flex items-center gap-2 text-xs">
                  {f.status === 'ok' ? (
                    <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
                  ) : f.status === 'bad' ? (
                    <ShieldAlert className="size-3.5 shrink-0 text-red-600" />
                  ) : (
                    <Shield className="size-3.5 shrink-0 text-muted-foreground/60" />
                  )}
                  <span
                    className={
                      f.status === 'unknown' ? 'text-muted-foreground/70' : 'text-foreground'
                    }
                  >
                    {f.label}
                  </span>
                  {f.status === 'unknown' && (
                    <span className="text-[10px] text-muted-foreground/60">· no data</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Activity log + CLMRS assessment — side by side on tablet+ */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Activity log (Sections B-G) */}
          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between p-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-sm">
                  <ListChecks className="size-4 text-muted-foreground" />
                  Activity log
                </h2>
                <p className="text-muted-foreground text-xs">
                  All farm operations recorded during this visit (Sections B–G)
                </p>
              </div>
              <StatusTag tone="neutral">{activities.length}</StatusTag>
            </header>
            {activities.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No activities recorded.
              </div>
            ) : (
              <ul className="divide-y">
                {activities.map((a, i) => (
                  <li key={a.key}>
                    <button
                      type="button"
                      onClick={() => setActivityIndex(i)}
                      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <StatusTag tone={a.tone} variant="icon">
                        <a.icon className="h-4 w-4" />
                      </StatusTag>
                      <div className="flex flex-1 flex-col gap-0.5">
                        <span className="font-medium text-sm">{a.label}</span>
                        <span className="text-muted-foreground text-xs">{a.summary}</span>
                      </div>
                      <span className="text-muted-foreground text-xs">{a.date ?? '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* CLMRS panel (Section H) */}
          <CLMRSPanel raw={raw} riskLevel={riskLevel} />
        </div>
      </div>

      {/* Activity drawer (Pencil V7L5A) */}
      <CoachingActivityDrawer
        open={activityIndex != null}
        onOpenChange={(o) => {
          if (!o) setActivityIndex(null);
        }}
        activity={selectedActivity}
        position={
          activityIndex != null ? { index: activityIndex, total: activities.length } : undefined
        }
        onPrev={
          activityIndex != null && activityIndex > 0
            ? () => setActivityIndex(activityIndex - 1)
            : undefined
        }
        onNext={
          activityIndex != null && activityIndex < activities.length - 1
            ? () => setActivityIndex(activityIndex + 1)
            : undefined
        }
      />
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'text-sm text-foreground'}>{value}</span>
    </div>
  );
}

function CLMRSPanel({
  raw,
  riskLevel,
}: {
  raw: Record<string, unknown>;
  riskLevel: 'no_risk' | 'at_risk' | 'case';
}) {
  const awareness = [
    { label: 'Heard of child labour', key: 'cl_heard' },
    { label: 'Knows difference vs family labour', key: 'cl_know_diff' },
    { label: 'Knows minimum age for light work', key: 'cl_know_light_age' },
    { label: 'Knows legal working age', key: 'cl_know_legal_age' },
    { label: 'Knows hazardous tasks', key: 'cl_know_hazardous' },
  ];
  const household = [
    { label: 'Children under 18 in household', key: 'cl_children_in_hh' },
    { label: 'Children help on farm', key: 'cl_children_help' },
    { label: 'Miss school for farm work', key: 'cl_miss_school' },
    { label: 'Carry heavy loads', key: 'cl_heavy_loads' },
    { label: 'SprayCan chemicals', key: 'cl_spray_chemicals' },
    { label: 'Use sharp tools', key: 'cl_sharp_tools' },
    { label: 'All enrolled in school', key: 'cl_enrolled' },
  ];
  const observation = [
    { label: 'Child observed working', key: 'cl_obs_child_working' },
    { label: 'Risk level', key: 'cl_obs_risk_level' },
  ];

  function read(group: string, key: string): string | null {
    return pick(raw, `sec_h_${group}/${key}`, `sec_h/sec_h_${group}/${key}`);
  }

  const riskPalette: Record<'no_risk' | 'at_risk' | 'case', { tone: StatusTone; label: string }> = {
    no_risk: { tone: 'success', label: 'No risk' },
    at_risk: { tone: 'caution', label: 'At risk' },
    case: { tone: 'danger', label: 'Child labour case' },
  };
  const rp = riskPalette[riskLevel];

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-sm">
            <ShieldAlert className="size-4 text-muted-foreground" />
            CLMRS assessment
          </h2>
          <p className="text-muted-foreground text-xs">
            Child labour risk: awareness · household · observation
          </p>
        </div>
        <StatusTag tone={rp.tone}>{rp.label}</StatusTag>
      </header>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <CLMRSGroup
          title="Awareness"
          items={awareness.map((i) => ({
            label: i.label,
            value: read('awareness', i.key),
          }))}
        />
        <CLMRSGroup
          title="Household"
          items={household.map((i) => ({
            label: i.label,
            value: read('household', i.key),
          }))}
        />
        <CLMRSGroup
          title="Enumerator observation"
          items={observation.map((i) => ({
            label: i.label,
            value: read('observation', i.key),
          }))}
        />
      </div>
    </section>
  );
}

function CLMRSGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string | null }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-[11px] uppercase tracking-wide">{title}</h4>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {items.map((i) => (
          <li
            key={i.label}
            className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1.5"
          >
            <span className="text-foreground text-xs">{i.label}</span>
            <StatusTag
              tone={
                i.value === 'yes' || i.value === 'no_risk'
                  ? 'success'
                  : i.value === 'at_risk'
                    ? 'caution'
                    : i.value === 'no' || i.value === 'case'
                      ? 'danger'
                      : 'neutral'
              }
            >
              <span className="capitalize">{(i.value ?? '—').replace(/_/g, ' ')}</span>
            </StatusTag>
          </li>
        ))}
      </ul>
    </div>
  );
}
