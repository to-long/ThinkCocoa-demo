/**
 * Coaching — Activity drawer (Pencil `V7L5A`).
 *
 * Slide-in sheet (~520px from right) showing the full detail of one
 * activity row from Section B–G of a coaching visit. Same layout
 * across all 6 activity types — sections are conditional on what
 * fields exist in that activity's raw payload.
 *
 * Prev/Next buttons let an auditor walk all activities in a visit
 * without closing the drawer.
 */

import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Leaf,
  type LucideIcon,
  SprayCan,
  Sprout,
  TreePine,
  TriangleAlert,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';

// ── shared activity model ──────────────────────────────────────

export type ActivityKind = 'chemical' | 'fertilizer' | 'weeding' | 'pruning' | 'harvest' | 'other';

export interface CoachingActivity {
  /** Globally unique within the activity list (used as React key). */
  key: string;
  kind: ActivityKind;
  sectionLabel: string;
  raw: Record<string, unknown>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: CoachingActivity | null;
  /** Optional navigation between activities. */
  position?: { index: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
}

// ── helpers ─────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

const KIND_META: Record<ActivityKind, { icon: LucideIcon; tone: StatusTone }> = {
  chemical: { icon: SprayCan, tone: 'info' },
  fertilizer: { icon: Sprout, tone: 'success' },
  weeding: { icon: Leaf, tone: 'caution' },
  pruning: { icon: TreePine, tone: 'info2' },
  harvest: { icon: ClipboardCheck, tone: 'warning' },
  other: { icon: FileText, tone: 'neutral' },
};

// ── main component ──────────────────────────────────────────────

export function CoachingActivityDrawer({
  open,
  onOpenChange,
  activity,
  position,
  onPrev,
  onNext,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[520px]">
        {activity ? (
          <ActivityBody activity={activity} position={position} onPrev={onPrev} onNext={onNext} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ActivityBody({
  activity,
  position,
  onPrev,
  onNext,
}: {
  activity: CoachingActivity;
  position?: { index: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const meta = KIND_META[activity.kind];
  const raw = activity.raw;

  // Per-kind field extraction. Each helper returns null if the row
  // doesn't carry that field so the section can hide cleanly.
  const date = pickDate(activity);
  const personResponsible = pickPerson(activity);
  const titleLine = pickTitle(activity);
  const flags = pickComplianceFlags(activity);
  const failingFlags = flags.filter((f) => f.status !== 'ok');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <SheetHeader className="border-b p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 items-center gap-3">
            <StatusTag tone={meta.tone} variant="icon">
              <meta.icon className="h-5 w-5" />
            </StatusTag>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <StatusTag tone={meta.tone}>{activity.sectionLabel}</StatusTag>
                <StatusTag tone="neutral" className="capitalize">
                  {activity.kind}
                </StatusTag>
              </div>
              <SheetTitle className="text-base">{titleLine ?? 'Activity'}</SheetTitle>
            </div>
          </div>
        </div>
        <SheetDescription className="sr-only">{activity.sectionLabel}</SheetDescription>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
          {date && (
            <span className="inline-flex items-center gap-1">
              <CalendarCheck className="size-3" />
              {date}
            </span>
          )}
          {personResponsible && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" />
              {personResponsible}
            </span>
          )}
        </div>
      </SheetHeader>

      {/* Verdict banner — only chemical has compliance flags */}
      {failingFlags.length > 0 && (
        <div className="flex items-start gap-2.5 border-yellow-200 border-b bg-yellow-50 p-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-white bg-yellow-500">
            <TriangleAlert className="size-3.5" />
          </span>
          <div className="flex flex-col">
            <span className="font-semibold text-yellow-800 text-xs">
              {failingFlags.length} compliance flag{failingFlags.length > 1 ? 's' : ''}
            </span>
            <span className="text-yellow-800 text-xs">
              {failingFlags.map((f) => f.label).join(' · ')}
            </span>
          </div>
        </div>
      )}

      {/* Body sections */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-4">
          {activity.kind === 'chemical' && <ChemicalSections raw={raw} />}
          {activity.kind === 'fertilizer' && <FertilizerSections raw={raw} />}
          {activity.kind === 'weeding' && <WeedingSections raw={raw} />}
          {activity.kind === 'pruning' && <PruningSections raw={raw} />}
          {activity.kind === 'harvest' && <HarvestSections raw={raw} />}
          {activity.kind === 'other' && <OtherSections raw={raw} />}
        </div>
      </div>

      {/* Footer */}
      {position && position.total > 1 && (
        <SheetFooter className="flex-row items-center justify-between border-t bg-muted/40 p-3">
          <span className="text-muted-foreground text-xs">
            Activity {position.index + 1} of {position.total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrev}
              disabled={!onPrev || position.index === 0}
            >
              <ChevronLeft className="mr-1 size-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              onClick={onNext}
              disabled={!onNext || position.index === position.total - 1}
            >
              Next
              <ChevronRight className="ml-1 size-3.5" />
            </Button>
          </div>
        </SheetFooter>
      )}
    </div>
  );
}

// ── per-kind body sections ─────────────────────────────────────

function ChemicalSections({ raw }: { raw: Record<string, unknown> }) {
  const ppe = str(raw['sec_b/chem_ppe']);
  const ppePills = ppe ? ppe.split(/\s+/).filter(Boolean) : [];
  const ALL_PPE = ['gloves', 'mask', 'boots', 'overalls', 'goggles', 'apron'];
  return (
    <>
      <Section title="Product">
        <Field label="Chemical type" value={str(raw['sec_b/chem_type'])} capitalize />
        <Field label="Product name" value={str(raw['sec_b/chem_product'])} />
        <Field label="Active ingredient" value={str(raw['sec_b/chem_active_ingredient'])} />
      </Section>
      <Section title="Application">
        <Field
          label="Quantity"
          value={
            str(raw['sec_b/chem_quantity']) && str(raw['sec_b/chem_unit'])
              ? `${str(raw['sec_b/chem_quantity'])} ${str(raw['sec_b/chem_unit'])}`
              : str(raw['sec_b/chem_quantity'])
          }
        />
        <Field
          label="Area treated"
          value={str(raw['sec_b/chem_area_ha']) ? `${str(raw['sec_b/chem_area_ha'])} ha` : null}
        />
        <Field label="Target pest" value={str(raw['sec_b/chem_target'])} capitalize />
        <Field label="Equipment" value={str(raw['sec_b/chem_equipment'])} capitalize />
        <Field label="Sprayer name" value={str(raw['sec_b/chem_sprayer_name'])} />
      </Section>
      <Section title="Safety & PPE">
        <CheckRow label="Sprayer trained" status={yesNoStatus(raw['sec_b/chem_sprayer_trained'])} />
        <CheckRow label="Correct dosage" status={yesNoStatus(raw['sec_b/chem_correct_dosage'])} />
        {ALL_PPE.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {ALL_PPE.map((item) => {
              const used = ppePills.includes(item);
              return (
                <span
                  key={item}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                    used ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700 line-through'
                  }`}
                >
                  {item}
                </span>
              );
            })}
          </div>
        )}
      </Section>
      <Section title="Environment">
        <CheckRow
          label="Buffer zone respected"
          status={yesNoStatus(raw['sec_b/chem_buffer_zones'])}
        />
        <CheckRow
          label="Re-entry period observed"
          status={yesNoStatus(raw['sec_b/chem_reentry'])}
        />
        <Field label="Container disposal" value={str(raw['sec_b/chem_container'])} capitalize />
      </Section>
      {str(raw['sec_b/chem_remarks']) && (
        <Section title="Coach remarks">
          <p className="text-foreground text-sm">{str(raw['sec_b/chem_remarks'])}</p>
        </Section>
      )}
    </>
  );
}

function FertilizerSections({ raw }: { raw: Record<string, unknown> }) {
  return (
    <>
      <Section title="Product">
        <Field label="Fertilizer type" value={str(raw['sec_c/fert_type'])} capitalize />
        <Field label="Product" value={str(raw['sec_c/fert_product'])} />
        <Field label="Nutrient" value={str(raw['sec_c/fert_nutrient'])} />
      </Section>
      <Section title="Application">
        <Field
          label="Quantity"
          value={
            str(raw['sec_c/fert_quantity']) && str(raw['sec_c/fert_unit'])
              ? `${str(raw['sec_c/fert_quantity'])} ${str(raw['sec_c/fert_unit'])}`
              : str(raw['sec_c/fert_quantity'])
          }
        />
        <Field
          label="Area covered"
          value={str(raw['sec_c/fert_area_ha']) ? `${str(raw['sec_c/fert_area_ha'])} ha` : null}
        />
        <Field label="Method" value={str(raw['sec_c/fert_method'])} capitalize />
      </Section>
    </>
  );
}

function WeedingSections({ raw }: { raw: Record<string, unknown> }) {
  return (
    <Section title="Weeding">
      <Field label="Method" value={str(raw['sec_d/weed_method'])} capitalize />
      <Field label="Weed pressure" value={str(raw['sec_d/weed_pressure'])} capitalize />
      <Field label="Chemicals" value={str(raw['sec_d/weed_chemical'])} />
    </Section>
  );
}

function PruningSections({ raw }: { raw: Record<string, unknown> }) {
  return (
    <Section title="Pruning">
      <Field label="Type" value={str(raw['sec_e/prune_type'])} capitalize />
      <Field label="Tools" value={str(raw['sec_e/prune_tools'])} capitalize />
      <Field label="Quality" value={str(raw['sec_e/prune_quality'])} capitalize />
    </Section>
  );
}

function HarvestSections({ raw }: { raw: Record<string, unknown> }) {
  return (
    <Section title="Harvest">
      <Field label="Period" value={str(raw['sec_f/harvest_period'])} capitalize />
      <Field label="Frequency" value={str(raw['sec_f/harvest_freq'])} capitalize />
      <Field label="Tools" value={str(raw['sec_f/harvest_tools'])} capitalize />
      <Field label="Pod maturity" value={str(raw['sec_f/harvest_maturity'])} capitalize />
    </Section>
  );
}

function OtherSections({ raw }: { raw: Record<string, unknown> }) {
  return (
    <Section title="Other activity">
      <Field label="Activity type" value={str(raw['sec_g/other_activity_type'])} capitalize />
      <Field label="Materials" value={str(raw['sec_g/other_materials'])} />
    </Section>
  );
}

// ── shared section / field primitives ──────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
        {title}
      </h4>
      <div className="flex flex-col gap-1.5 rounded-md border bg-card p-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string | null;
  capitalize?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-right text-foreground ${capitalize ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  );
}

type Status = 'ok' | 'warn' | 'bad' | 'unknown';

function yesNoStatus(v: unknown): Status {
  const s = str(v);
  if (s === 'yes') return 'ok';
  if (s === 'no') return 'bad';
  return 'unknown';
}

function CheckRow({ label, status }: { label: string; status: Status }) {
  const palette = {
    ok: { bg: 'bg-emerald-50', fg: 'text-emerald-700', text: 'Yes' },
    warn: { bg: 'bg-yellow-50', fg: 'text-yellow-800', text: 'Partial' },
    bad: { bg: 'bg-red-50', fg: 'text-red-700', text: 'No' },
    unknown: { bg: 'bg-muted', fg: 'text-muted-foreground', text: '—' },
  }[status];
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-foreground">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 font-semibold text-[10px] ${palette.bg} ${palette.fg}`}
      >
        {palette.text}
      </span>
    </div>
  );
}

// ── per-kind helpers (title / date / person / flags) ───────────

function pickDate(a: CoachingActivity): string | null {
  switch (a.kind) {
    case 'chemical':
      return str(a.raw['sec_b/chem_app_date']);
    case 'fertilizer':
      return str(a.raw['sec_c/fert_app_date']);
    case 'weeding':
      return str(a.raw['sec_d/weed_date']);
    case 'pruning':
      return str(a.raw['sec_e/prune_date']);
    case 'other':
      return str(a.raw['sec_g/other_activity_date']);
    default:
      return null;
  }
}

function pickPerson(a: CoachingActivity): string | null {
  const key = {
    chemical: 'sec_b/chem_person',
    fertilizer: 'sec_c/fert_person',
    weeding: 'sec_d/weed_person',
    pruning: 'sec_e/prune_person',
    harvest: 'sec_f/harvest_person',
    other: 'sec_g/other_person',
  }[a.kind];
  const v = str(a.raw[key]);
  if (!v) return null;
  return v.replace(/_/g, ' ');
}

function pickTitle(a: CoachingActivity): string | null {
  switch (a.kind) {
    case 'chemical':
      return [str(a.raw['sec_b/chem_product']), str(a.raw['sec_b/chem_type'])]
        .filter(Boolean)
        .join(' · ');
    case 'fertilizer':
      return [str(a.raw['sec_c/fert_product']), str(a.raw['sec_c/fert_type'])]
        .filter(Boolean)
        .join(' · ');
    case 'weeding':
      return `${str(a.raw['sec_d/weed_method']) ?? 'Weeding'} · ${
        str(a.raw['sec_d/weed_pressure']) ?? '—'
      } pressure`;
    case 'pruning':
      return `${str(a.raw['sec_e/prune_type']) ?? 'Pruning'} · ${
        str(a.raw['sec_e/prune_quality']) ?? '—'
      }`;
    case 'harvest':
      return `${str(a.raw['sec_f/harvest_period']) ?? 'Harvest'} · ${
        str(a.raw['sec_f/harvest_freq']) ?? '—'
      }`;
    case 'other':
      return str(a.raw['sec_g/other_activity_type']);
  }
}

function pickComplianceFlags(a: CoachingActivity): { label: string; status: Status }[] {
  if (a.kind !== 'chemical') return [];
  return [
    { label: 'Sprayer trained', status: yesNoStatus(a.raw['sec_b/chem_sprayer_trained']) },
    { label: 'Correct dosage', status: yesNoStatus(a.raw['sec_b/chem_correct_dosage']) },
    { label: 'Buffer zones', status: yesNoStatus(a.raw['sec_b/chem_buffer_zones']) },
    { label: 'Re-entry', status: yesNoStatus(a.raw['sec_b/chem_reentry']) },
  ];
}
