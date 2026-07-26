/**
 * Compare modal — mirrors Pencil `bhxDs` (Compare Farmer) + `C0fbT`
 * (Compare Parcel).
 *
 * Layout (per Pencil): 3-column table inside the dialog body.
 *   Field | MASTER (current) | INSPECTION (new) | [checkbox]
 *
 * - Header (title + description + single "N/total unmatched" badge)
 *   has NO border-bottom — content flows directly into the table.
 * - Diff rows: amber-50 background, bold values on both sides, red
 *   arrow between master and inspection, per-row checkbox visible.
 * - Match rows: transparent background, muted text, no checkbox
 *   shown (a 16px spacer keeps columns aligned).
 * - Footer button reads "Apply N changes" where N = ticked
 *   checkboxes (defaults to all diffs on mount).
 *
 * Apply-to-master (Phase 3) is wired: clicking the footer button
 * POSTs the ticked field-keys to `/api/inspections/:id/apply-changes`,
 * which fans out to `updateFarmer()` / `updateParcel()` (canonical
 * services — full audit log, permission gate, cache invalidation).
 * The BE returns a refreshed `comparison`; we write it straight into
 * the SWR cache so checkboxes/badges flip without a refetch, then
 * invalidate `/api/farmers` + `/api/parcels` globally so any
 * consumer displaying the joined names sees the new values.
 */

import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ApiComparisonSection,
  applyInspectionChanges,
  useApiErrorToast,
  useApiSuccessToast,
  useInspectionComparison,
} from '@/shared/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspectionId: string;
  /** Which section to render: farmer (Farmer Identity card) or
   *  parcel (Farm / Parcel Details card). */
  section: 'farmer' | 'parcel';
}

export function CompareModal({ open, onOpenChange, inspectionId, section }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const successToast = useApiSuccessToast();
  const errorToast = useApiErrorToast();
  const { mutate: globalMutate } = useSWRConfig();
  const {
    data: cmp,
    isLoading,
    mutate: mutateComparison,
  } = useInspectionComparison(open ? inspectionId : null);
  const [applying, setApplying] = useState(false);

  const title =
    section === 'farmer'
      ? t('inspections.compare.farmerTitle')
      : t('inspections.compare.parcelTitle');
  const description = t('inspections.compare.description');

  const sectionData = cmp?.[section];

  // Set of field keys the admin has ticked to apply.
  // Defaults to ALL diff keys on every fresh data load — admin
  // un-ticks ones they want to skip.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sectionData) return;
    setSelectedKeys(new Set(sectionData.fields.filter((f) => f.isDiff).map((f) => f.key)));
  }, [sectionData]);

  const onToggle = (key: string, next: boolean) => {
    setSelectedKeys((prev) => {
      const out = new Set(prev);
      if (next) out.add(key);
      else out.delete(key);
      return out;
    });
  };

  const onToggleAll = (next: boolean) => {
    if (!sectionData) return;
    if (next) {
      setSelectedKeys(new Set(sectionData.fields.filter((f) => f.isDiff).map((f) => f.key)));
    } else {
      setSelectedKeys(new Set());
    }
  };

  const applyCount = selectedKeys.size;

  /**
   * Send the selected diff field-keys to the BE. On success:
   *   • write the fresh comparison straight into THIS hook's cache
   *     (so checkboxes/badges flip without a refetch)
   *   • invalidate inspection detail + farmer/parcel master caches
   *     globally — anyone displaying joined names / fields sees the
   *     applied values on next render
   *   • toast `applied X · skipped Y` and clear local selection.
   * On error: surface the BE error message via the standard toast
   *   helper (handles 403 / 400 / 404 with the route's `code` field).
   */
  const handleApply = async () => {
    if (applyCount === 0 || applying) return;
    setApplying(true);
    try {
      const res = await applyInspectionChanges(inspectionId, {
        section,
        keys: [...selectedKeys],
      });
      // Local SWR write — instant UI flip on this modal's diff table.
      await mutateComparison(res.comparison, { revalidate: false });
      // Global invalidation. Apply touched the farmer / parcel master
      // (joined names on inspection list/detail) AND wrote audit
      // rows (shown in /admin/audit-logs + notification bell), so
      // invalidate all four roots. The SSE audit-log push that fires
      // from the BE trigger covers the notification bell live, but
      // refetch is cheap and ensures the admin pages we just left
      // don't show stale data when navigated back to.
      const INVALIDATE_ROOTS = [
        '/api/farmers',
        '/api/parcels',
        '/api/inspections',
        '/api/audit-logs',
      ];
      await globalMutate(
        (key) =>
          Array.isArray(key) && typeof key[0] === 'string' && INVALIDATE_ROOTS.includes(key[0]),
        undefined,
        { revalidate: true },
      );
      // 3-way toast:
      //   applied=0 + skipped>0  → "Skipped all — inspection values empty"
      //   applied>0 + skipped>0  → "Applied N · Skipped M"
      //   applied>0 + skipped=0  → "Applied N changes"
      const toastId =
        res.applied.length === 0
          ? 'inspections.compare.applyAllSkipped'
          : res.skipped.length > 0
            ? 'inspections.compare.applyOkWithSkipped'
            : 'inspections.compare.applyOk';
      successToast({
        id: toastId,
        values: { applied: res.applied.length, skipped: res.skipped.length },
      });
      // Clear selection so the next set defaults to remaining diffs.
      setSelectedKeys(new Set());
      // Close the modal once apply succeeded — the toast + audit feed
      // already confirm what happened, and the master + comparison
      // caches above were invalidated, so anything the admin opens
      // next will reflect the fresh state. Failed applies keep the
      // modal open so the admin can retry without re-ticking checkboxes.
      onOpenChange(false);
    } catch (err) {
      errorToast(err);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 gap-0">
        {/* Header — title, description, single "N/total unmatched"
            badge. shadcn DialogContent injects its own close X at
            top-4 right-4, so reserve pr-12 to avoid collision. NO
            border-bottom (matches Pencil). */}
        {/* pt-4 (16px) matches the close button's `top-4` so the
            title sits on the same horizontal line as the X. */}
        <div className="flex flex-col gap-3 px-6 pt-4 pb-4 pr-12">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-[13px] leading-snug text-muted-foreground">{description}</p>
          </div>
          {sectionData && !sectionData.missing ? (
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fefce8] px-2.5 py-1 text-xs font-semibold text-[#854d0e]">
                <span className="size-1.5 rounded-full bg-[#ca8a04]" />
                {intl.formatMessage(
                  { id: 'inspections.compare.unmatchedCount' },
                  { n: sectionData.diffs, total: sectionData.fields.length },
                )}
              </span>
            </div>
          ) : null}
        </div>

        {/* Body — column header + scrollable rows */}
        <div className="flex max-h-[60vh] flex-col overflow-y-auto px-6 pb-4">
          {isLoading || !sectionData ? (
            <Skeleton className="h-48 w-full" />
          ) : sectionData.missing ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              {t('inspections.compare.missingMaster')}
            </div>
          ) : (
            <CompareTable
              section={sectionData}
              selectedKeys={selectedKeys}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
            />
          )}
        </div>

        {/* Footer — Cancel + Apply N changes, border-top */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('inspections.compare.close')}
          </Button>
          <Button
            disabled={!sectionData || sectionData.missing || applyCount === 0 || applying}
            onClick={handleApply}
          >
            {applying
              ? t('inspections.compare.applying')
              : intl.formatMessage({ id: 'inspections.compare.applyN' }, { n: applyCount })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

function CompareTable({
  section,
  selectedKeys,
  onToggle,
  onToggleAll,
}: {
  section: ApiComparisonSection;
  selectedKeys: Set<string>;
  onToggle: (key: string, next: boolean) => void;
  onToggleAll: (next: boolean) => void;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  // Select-all checkbox state. Tri-state:
  //   no diffs ticked → unchecked
  //   all diffs ticked → checked
  //   some ticked → indeterminate
  const diffCount = section.diffs;
  const selectedCount = selectedKeys.size;
  const allChecked: boolean | 'indeterminate' =
    selectedCount === 0 ? false : selectedCount >= diffCount ? true : 'indeterminate';

  return (
    <div className="flex flex-col">
      {/* Column header */}
      <div className="flex items-center gap-3 px-4 py-1.5">
        <span className="w-[120px] shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground">
          {t('inspections.compare.colField')}
        </span>
        {/* Three-up: master cell | arrow spacer | inspection cell.
            Arrow column is a fixed 14px so the per-row red arrows
            on diff rows all line up at the same x. */}
        <span className="min-w-0 flex-1 text-[11px] font-semibold tracking-wide text-foreground">
          {t('inspections.compare.colMaster')}
        </span>
        <span className="w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[11px] font-semibold tracking-wide text-foreground">
          {t('inspections.compare.colInspection')}
        </span>
        <div className="flex w-4 shrink-0 items-center justify-center">
          {diffCount > 0 ? (
            <Checkbox
              // `relative` + `before:-inset-3` extends an invisible
              // 12px click target around the 16px box — much easier
              // to hit on touch + dense table. Layout unchanged
              // because `::before` is positioned, not flow-affecting.
              className="relative before:absolute before:-inset-3 before:rounded-md before:content-['']"
              checked={allChecked}
              onCheckedChange={(v) => onToggleAll(v === true)}
              aria-label={t('inspections.compare.toggleAll')}
            />
          ) : null}
        </div>
      </div>

      {/* Rows */}
      {section.fields.map((f) => (
        <CompareRow
          key={f.key}
          field={f}
          checked={selectedKeys.has(f.key)}
          onToggle={(next) => onToggle(f.key, next)}
        />
      ))}
    </div>
  );
}

function CompareRow({
  field,
  checked,
  onToggle,
}: {
  field: ApiComparisonSection['fields'][number];
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const isDiff = field.isDiff;
  return (
    <div
      className={`flex items-center gap-3 border-b border-border px-4 py-3 ${
        isDiff ? 'bg-[#fefce8]' : 'bg-transparent'
      }`}
    >
      {/* Field label */}
      <span className="w-[120px] shrink-0 text-xs font-medium text-muted-foreground">
        {field.label}
      </span>

      {/* Master cell — `break-words` so a single long value (e.g.
          long ID) wraps inside the cell rather than overflowing
          the row; `truncate` removed because user wants the full
          value visible, even if rare 30+ char values wrap. */}
      <span
        className={`min-w-0 flex-1 break-words text-[13px] ${
          isDiff ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'
        }`}
      >
        {field.master ?? '—'}
      </span>
      {/* Arrow column — fixed 14px so the red arrow on every diff
          row sits at the SAME x (no drift from variable-length
          master values). Match rows render an empty 14px spacer. */}
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        {isDiff ? <ArrowRight className="size-3.5 text-red-400" aria-hidden="true" /> : null}
      </span>
      {/* Inspection cell — full value, no truncation. */}
      <span
        className={`min-w-0 flex-1 break-words text-[13px] ${
          isDiff ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'
        }`}
      >
        {field.inspection ?? '—'}
      </span>

      {/* Checkbox column — only rendered when this field differs;
          16px spacer otherwise keeps every row column-aligned. */}
      <div className="flex w-4 shrink-0 items-center justify-center">
        {isDiff ? (
          <Checkbox
            // Extended invisible 12px hit area around the box —
            // pseudo-element so layout / column width unchanged.
            className="relative before:absolute before:-inset-3 before:rounded-md before:content-['']"
            checked={checked}
            onCheckedChange={(v) => onToggle(v === true)}
            aria-label={`Apply ${field.label}`}
          />
        ) : null}
      </div>
    </div>
  );
}
