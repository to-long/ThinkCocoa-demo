/**
 * Farm detail — mirrors the Pencil `MnYAv` design at a code level.
 *
 *   1. Header           — title + subtitle + Edit button
 *   2. Profile card     — name + parcel-status badges
 *   3. Farm Info card   — 5 rows of 2-up fields (Field ID, Crop/Planting Date,
 *                         Tree Count/Area, Cooperative/Farmer, Society/Status)
 *   4. Map Geometry     — placeholder map preview ("no map yet" if absent)
 *   5. EUDR Compliance  — status row + assessed-at row
 *   6. Farm Management  — Archive / Delete / Restore actions
 */

import {
  History,
  MapPin,
  Pencil,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Sprout,
  SquareArrowOutUpRight,
  Trash2,
  TreePine,
} from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { PermissionGate } from '@/features/auth';
import { formatGhanaDate } from '@/lib/datetime';
import {
  deleteParcel,
  restoreParcel,
  updateParcel,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useParcel,
} from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { FarmDialog } from './farm-dialog';
import { MapGeometryViewer } from './map-geometry-viewer';
import { ParcelCorrectiveActionsCard } from './parcel-corrective-actions-card';
import { ParcelInspectionsCard } from './parcel-inspections-card';

interface Props {
  parcelId: string;
}

// Status / EUDR badge palette — kept in sync with the farms list
// (`farms-page-content.tsx`) so a parcel's badge looks identical on
// the list row and on the detail card. Dot color matches text color.
// Parcel status → shared StatusTag tone (dot variant).
const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  inactive: 'caution',
  archived: 'neutral',
  deleted: 'neutral',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm text-foreground break-words">{value ?? '—'}</div>
    </div>
  );
}

// Map an EUDR assessment value (risk level / pass-fail) to a StatusTag tone.
function eudrTone(value: string): StatusTone {
  const v = value.trim().toLowerCase();
  if (['low', 'pass', 'yes', 'compliant', 'ok', 'none', 'clear'].includes(v)) return 'success';
  if (['medium', 'moderate', 'review', 'needs_review', 'warning'].includes(v)) return 'caution';
  if (['high', 'fail', 'no', 'non_compliant', 'non-compliant', 'overlap'].includes(v))
    return 'danger';
  return 'neutral';
}

// Render an EUDR assessment value as a coloured StatusTag (dash when empty).
function EudrTag({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  return (
    <StatusTag tone={eudrTone(value)} dot>
      {value}
    </StatusTag>
  );
}

export function FarmDetailPageContent({ parcelId }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  const errorToast = useApiErrorToast();
  const errorMessage = useApiErrorMessage();
  const successToast = useApiSuccessToast();
  const { data: parcel, isLoading, error } = useParcel(parcelId);

  useBreadcrumb([
    { label: t('farms.title'), href: '/farms' },
    { label: parcel?.parcelName || parcelId },
  ]);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!parcel) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <p className="text-muted-foreground">
          {error ? errorMessage(error) : t('farms.detail.noMap')}
        </p>
        <Button variant="outline" onClick={() => navigate('/farms')}>
          {t('farms.detail.backToList')}
        </Button>
      </div>
    );
  }

  const isDeleted = !!parcel.deletedAt;

  // Profile-card avatar initials — pulled from the parcel name (e.g.
  // "Mensah Farm A" → "MF"), falling back to the parcel ID's
  // alpha-prefix (e.g. "AK001WP009" → "AK"). Pencil `oCuVk`.
  const avatarInitials = (() => {
    const fromName = (parcel.parcelName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .join('')
      .slice(0, 2);
    if (fromName.length >= 2) return fromName;
    const fromId = parcel.id.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
    return fromId.slice(0, 2) || fromName || '?';
  })();

  return (
    // Page padding comes from the outer app layout — same pattern as
    // farmer-detail-page-content. Full-width to match VSLA detail;
    // gap-4 (16px) matches the Pencil contentArea gap between cards.
    <div className="flex flex-col gap-4">
      {/* Header — title + subtitle on the left, Edit button on the
          right. Matches farmer-detail-page-content. */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BackButton fallbackTo="/farms" preferHistory />
            <h1 className="text-2xl font-semibold text-foreground">{t('farms.detail.title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('farms.detail.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* History — audit feed pre-pinned to THIS parcel via
              `entityId`. Matches the same button pattern on
              farmer-detail. */}
          <PermissionGate codes={['parcel:notification']}>
            <Button variant="outline" asChild>
              <Link to={`/notifications?entityId=${encodeURIComponent(parcelId)}`}>
                <History className="size-4" />
                {t('common.history')}
              </Link>
            </Button>
          </PermissionGate>
          <PermissionGate codes={['parcel:update']}>
            {!isDeleted && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                {t('farms.actions.edit')}
              </Button>
            )}
          </PermissionGate>
        </div>
      </div>

      {/* Profile — Pencil `hKeFX` is compact: padding 12, gap 12.
          Match farmer-detail's profile pattern (plain div, not Card)
          so we don't inherit shadcn's chunky default Card vertical
          gap. */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground">
          {avatarInitials}
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold">{parcel.parcelName ?? parcel.id}</span>
            {(() => {
              const key = isDeleted ? 'deleted' : parcel.parcelStatus;
              return (
                <StatusTag tone={STATUS_TONE[key] ?? 'success'} dot>
                  {t(`farms.status.${key}`)}
                </StatusTag>
              );
            })()}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <StatusTag tone="neutral">
              <span className="font-mono">{parcel.id}</span>
            </StatusTag>
            <span>·</span>
            <span>
              {parcel.calculatedAreaHa != null
                ? `${parcel.calculatedAreaHa.toFixed(2)} ha`
                : '— ha'}
              {parcel.cocoaTreeCount != null ? ` · ${parcel.cocoaTreeCount} trees` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Quick-glance tile row — EUDR, Shade Tree, Area, Trees. Same
          icon-left / content-right pattern as farmer-detail so the
          most-scanned parcel signals sit above the info card. */}
      {(() => {
        const eudrKey = parcel.eudrStatus ?? 'unknown';
        const eudrTone: StatusTone =
          eudrKey === 'compliant'
            ? 'success'
            : eudrKey === 'non_compliant'
              ? 'danger'
              : eudrKey === 'needs_review'
                ? 'warning'
                : 'neutral';
        const shadePct = parcel.shadeSurvivalPct;
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <StatusTag tone={eudrTone} variant="icon">
                <ShieldCheck className="size-5" />
              </StatusTag>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {t('farms.detail.eudrCompliance')}
                </span>
                {/* A verdict, so it wears the same chip it does in the
                    list — plain text made the one tile that carries a
                    compliance decision look like a label. */}
                <StatusTag tone={eudrTone} dot>
                  {t(`farms.eudr.${eudrKey}`)}
                </StatusTag>
              </div>
            </div>

            <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <StatusTag tone="success" variant="icon">
                <TreePine className="size-5" />
              </StatusTag>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {t('farmers.detail.shadeTree')}
                </span>
                <span className="text-foreground text-sm">
                  {shadePct == null ? '—' : `${shadePct.toFixed(0)}%`}
                </span>
              </div>
            </div>

            <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <StatusTag tone="info" variant="icon">
                <Ruler className="size-5" />
              </StatusTag>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {t('farms.table.area')}
                </span>
                <span className="text-foreground text-sm">
                  {parcel.calculatedAreaHa != null
                    ? `${parcel.calculatedAreaHa.toFixed(2)} ha`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <StatusTag tone="info2" variant="icon">
                <Sprout className="size-5" />
              </StatusTag>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {t('farms.table.trees')}
                </span>
                <span className="text-foreground text-sm">
                  {parcel.cocoaTreeCount != null ? String(parcel.cocoaTreeCount) : '—'}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Corrective actions — aggregated across this parcel's inspections,
          sitting right below the stat tiles (same amber card as the
          internal-inspection detail). Renders nothing when there are none. */}
      <ParcelCorrectiveActionsCard parcelId={parcelId} />

      {/* Farm Info — mirrors Pencil `1OERh`. 5 rows × 2-up fields.
          Padding 16 (py-4 / px-4), header→content + row gap 10
          (gap-2.5) — overriding shadcn's chunky py-6 / gap-6 / px-6
          defaults so the card matches the compact Pencil spec. */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sprout className="size-4 text-muted-foreground" />
            {t('farms.detail.farmInfo')}
          </CardTitle>
          <CardDescription>{t('farms.detail.farmInfoDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {/* Single grid so fields flow densely into 4 columns on wide
              screens (was 5 independent 2-up grids that never filled the
              row). */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label={t('farms.table.fieldId')} value={parcel.id} />
            <Field
              label={`${t('farms.table.crop')} / ${t('farms.table.plantingDate')}`}
              value={
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span>{parcel.cropType ?? '—'}</span>
                  {parcel.plantingDate && <span>· {formatGhanaDate(parcel.plantingDate)}</span>}
                </span>
              }
            />
            <Field
              label={t('farms.table.farmer')}
              value={
                <PermissionGate
                  codes={['farmer:read']}
                  fallback={<span>{parcel.farmerFullName}</span>}
                >
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 text-foreground hover:underline"
                    onClick={() => navigate(`/farmers/${encodeURIComponent(parcel.farmerId)}`)}
                    title={parcel.farmerId}
                  >
                    {parcel.farmerFullName}
                    <SquareArrowOutUpRight className="size-3.5 text-muted-foreground" />
                  </button>
                </PermissionGate>
              }
            />
            <Field
              label={t('farms.detail.cocoaVariety')}
              value={
                parcel.cocoaVariety ? (
                  <StatusTag tone="info" dot>
                    {t(`farms.variety.${parcel.cocoaVariety}`)}
                  </StatusTag>
                ) : (
                  '—'
                )
              }
            />
            <Field label={t('farms.detail.treeSpacing')} value={parcel.treeSpacing ?? '—'} />
            <Field
              label={t('farms.detail.landOwnership')}
              value={
                parcel.landOwnershipType ? t(`farms.ownership.${parcel.landOwnershipType}`) : '—'
              }
            />
            <Field
              label={t('farms.detail.nearbyFeature')}
              value={parcel.nearbyFeatureType ? t(`farms.nearby.${parcel.nearbyFeatureType}`) : '—'}
            />
            <Field
              label={t('farms.detail.willingToRehab')}
              value={
                parcel.willingToRehabilitate == null ? (
                  '—'
                ) : (
                  <StatusTag tone={parcel.willingToRehabilitate ? 'success' : 'neutral'}>
                    {parcel.willingToRehabilitate ? t('farms.detail.yes') : t('farms.detail.no')}
                  </StatusTag>
                )
              }
            />
            <Field
              label={t('farms.detail.parcelStatus')}
              value={
                <StatusTag tone={STATUS_TONE[parcel.parcelStatus] ?? 'neutral'} dot>
                  {t(`farms.status.${parcel.parcelStatus}`)}
                </StatusTag>
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* EUDR — compact card (16/10 spec). Sits directly above the map. */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-muted-foreground" />
            {t('farms.detail.eudrCompliance')}
          </CardTitle>
          <CardDescription>{t('farms.detail.eudrComplianceDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t('farms.table.status')}
              value={
                <StatusTag tone={eudrTone(parcel.eudrStatus ?? 'unknown')} dot>
                  {t(`farms.eudr.${parcel.eudrStatus ?? 'unknown'}`)}
                </StatusTag>
              }
            />
            <Field
              label="Assessed on"
              value={parcel.eudr?.assessedAt ? formatGhanaDate(parcel.eudr.assessedAt) : '—'}
            />
            <Field label="Assessed by" value={parcel.eudr?.assessedBy || '—'} />
            <Field
              label="Deforestation Risk"
              value={<EudrTag value={parcel.eudr?.deforestationRisk ?? null} />}
            />
            <Field
              label="Protected Area Risk"
              value={<EudrTag value={parcel.eudr?.protectedAreaRisk ?? null} />}
            />
            <Field label="Overlap" value={<EudrTag value={parcel.eudr?.overlap ?? null} />} />
            <Field label="On Land" value={<EudrTag value={parcel.eudr?.onLand ?? null} />} />
            <Field label="In Country" value={<EudrTag value={parcel.eudr?.inCountry ?? null} />} />
          </div>
          <Field label="Explanation" value={parcel.eudr?.explanation || '—'} />
          <Field label="Notes" value={parcel.eudr?.notes || '—'} />
        </CardContent>
      </Card>

      {/* Map Geometry — 16:9 preview. */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4 text-muted-foreground" />
            {t('farms.detail.mapGeometry')}
          </CardTitle>
          <CardDescription>{t('farms.detail.mapGeometryDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {parcel.geojson ? (
            <MapGeometryViewer
              geojson={parcel.geojson}
              riskZones={parcel.riskZones}
              className="h-[400px] w-full"
            />
          ) : (
            <div className="flex h-[400px] flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
              <MapPin className="size-8" />
              <span>{t('farms.detail.noMap')}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Internal inspections — Kobo-sourced field audits for this parcel. */}
      <ParcelInspectionsCard parcelId={parcelId} />

      {/* Farm Management — compact card (16/10 spec). */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Pencil className="size-4 text-muted-foreground" />
            {t('farms.detail.management')}
          </CardTitle>
          <CardDescription>{t('farms.detail.managementDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 flex flex-wrap gap-3">
          {isDeleted ? (
            <PermissionGate codes={['parcel:delete']}>
              <Button onClick={() => setRestoreOpen(true)}>
                <RotateCcw className="size-4" />
                {t('farms.detail.restore')}
              </Button>
            </PermissionGate>
          ) : (
            <PermissionGate codes={['parcel:delete']}>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" />
                {t('farms.detail.deleteFarm')}
              </Button>
            </PermissionGate>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <FarmDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={async (data) => {
          try {
            await updateParcel(parcel.id, data);
            successToast({
              id: 'farms.toast.updated',
              values: { name: parcel.parcelName || parcel.id },
            });
            setEditOpen(false);
          } catch (e) {
            errorToast(e);
            throw e;
          }
        }}
        initialData={parcel}
      />

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('farms.deleteDialog.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(
                { id: 'farms.deleteDialog.description' },
                { name: parcel.parcelName || parcel.id },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('farms.deleteDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await deleteParcel(parcel.id);
                  successToast({
                    id: 'farms.toast.deleted',
                    values: { name: parcel.parcelName || parcel.id },
                  });
                  navigate('/farms');
                } catch (e) {
                  errorToast(e);
                }
              }}
            >
              {t('farms.deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore dialog */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('farms.restoreDialog.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(
                { id: 'farms.restoreDialog.description' },
                { name: parcel.parcelName || parcel.id },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreOpen(false)}>
              {t('farms.restoreDialog.cancel')}
            </Button>
            <Button
              onClick={async () => {
                try {
                  await restoreParcel(parcel.id);
                  successToast({
                    id: 'farms.toast.restored',
                    values: { name: parcel.parcelName || parcel.id },
                  });
                  setRestoreOpen(false);
                } catch (e) {
                  errorToast(e);
                }
              }}
            >
              {t('farms.restoreDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
