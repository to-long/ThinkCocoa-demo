/**
 * Cooperative detail view — matches the Pencil `hxJL3` design:
 *
 *   1. Header             — title + subtitle + Edit button
 *   2. Profile card       — building avatar + name + status pill +
 *                           RA Certified pill (when ≥1 cert farmer) +
 *                           "<District> · <N> Farmers" subtitle
 *   3. Chair & Contact    — Coop chair + email row, description row
 *   4. Certification      — certified count + "RA Certified" pill,
 *                           not-certified count, certification rate,
 *                           data collection consent
 *   5. Overview           — total farmers / fields / parcels / area
 *   6. Cooperative Mgmt   — Deactivate + Delete buttons
 *
 * Layout convention copied from the farmer-detail page: tight card
 * padding (`py-4 gap-3` + `px-4`) and a 2-col grid for paired fields.
 */

import type { CreateCooperativeInput, UpdateCooperativeInput } from '@cocoaimpact/shared';
import {
  Award,
  BadgeCheck,
  Ban,
  Building2,
  Contact,
  Pencil,
  Settings2,
  Trash2,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGate } from '@/features/auth';
import {
  type ApiCooperative,
  deleteCooperative,
  removeCooperativeMember,
  updateCooperative,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useCooperative,
  useCooperativeMembers,
} from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { CooperativeDialog } from './cooperative-dialog';
import { DeleteCooperativeDialog } from './delete-cooperative-dialog';

interface Props {
  cooperativeId: string;
}

function InfoField({
  label,
  value,
  /** Long-form prose values (description, address) read better in
   *  the regular weight — use `normal` for those. Default is `medium`
   *  to keep numeric / short-text fields scannable. */
  weight = 'medium',
}: {
  label: string;
  value: React.ReactNode;
  weight?: 'normal' | 'medium';
}) {
  return (
    // `min-w-0` lets this column shrink below its intrinsic width
    // inside the parent grid so `break-all` on the value can actually
    // wrap. Without it, a 250-char unbroken email overflows the card.
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div
        className={`text-sm text-foreground break-all ${
          weight === 'medium' ? 'font-medium' : 'font-normal'
        }`}
      >
        {value ?? '—'}
      </div>
    </div>
  );
}

/** Compute the display value for "Certification Rate". Returns a string
 *  with one decimal place (e.g. "66.7%"), or "—" when the cooperative
 *  has no farmers yet. */
function certificationRate(c: ApiCooperative): string {
  if (c.farmerCount === 0) return '—';
  const pct = (c.certifiedFarmerCount / c.farmerCount) * 100;
  return `${pct.toFixed(1)}%`;
}

/** Cooperative-level "did farmers consent to data collection?" — yes if
 *  at least one consent was recorded. Mirrors how the FE currently
 *  surfaces this for an individual farmer; FE may switch to a
 *  percentage display later. */
function consentDisplay(c: ApiCooperative, t: (k: string) => string): React.ReactNode {
  if (c.consentingFarmerCount > 0) {
    return <span className="text-green-600">{t('cooperatives.detail.dataConsentYes')}</span>;
  }
  return t('cooperatives.detail.dataConsentNo');
}

function totalAreaDisplay(c: ApiCooperative): string {
  if (!c.totalAreaHa) return '—';
  const num = Number.parseFloat(c.totalAreaHa);
  if (!Number.isFinite(num) || num === 0) return '—';
  return num.toFixed(1);
}

export function CooperativeDetailPageContent({ cooperativeId }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();
  const t = (k: string) => intl.formatMessage({ id: k });
  const getErrorMessage = useApiErrorMessage();
  const { data: c, isLoading, error } = useCooperative(cooperativeId);

  useBreadcrumb([
    { label: t('cooperatives.title'), href: '/admin/cooperatives' },
    { label: c?.name ?? cooperativeId },
  ]);

  // Permission gates are handled via <PermissionGate> in JSX below.
  // Server enforces too; gates here just hide controls. Member-remove
  // is gated on `user:update` because removing a coop assignment is a
  // user-side mutation (`iam.user_cooperative_assignments`).

  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  const { data: members, isLoading: membersLoading } = useCooperativeMembers(cooperativeId);

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      try {
        await removeCooperativeMember(cooperativeId, userId);
        successToast({ id: 'cooperatives.toast.memberRemoved' });
      } catch (err) {
        errorToast(err);
      }
    },
    [cooperativeId, errorToast, successToast],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleEdit = useCallback(
    async (data: CreateCooperativeInput | UpdateCooperativeInput) => {
      if (!c) return;
      setPageError(null);
      try {
        await updateCooperative(c.id, data as UpdateCooperativeInput);
        successToast({
          id: 'cooperatives.toast.updated',
          values: { name: c.name },
        });
      } catch (err) {
        setPageError(getErrorMessage(err));
        throw err;
      }
    },
    [c, getErrorMessage, successToast],
  );

  const handleDelete = useCallback(async () => {
    if (!c) return;
    setPageError(null);
    try {
      await deleteCooperative(c.id);
      successToast({
        id: 'cooperatives.toast.deleted',
        values: { name: c.name },
      });
      navigate('/admin/cooperatives');
    } catch (err) {
      setPageError(getErrorMessage(err));
    }
  }, [c, navigate, getErrorMessage, successToast]);

  const handleToggleActive = useCallback(async () => {
    if (!c) return;
    setPageError(null);
    try {
      const nextActive = !c.isActive;
      await updateCooperative(c.id, { isActive: nextActive });
      successToast({
        id: nextActive ? 'cooperatives.toast.activated' : 'cooperatives.toast.deactivated',
        values: { name: c.name },
      });
    } catch (err) {
      setPageError(getErrorMessage(err));
    }
  }, [c, getErrorMessage, successToast]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full max-w-3xl" />
        <Skeleton className="h-32 w-full max-w-3xl" />
      </div>
    );
  }

  if (!c) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <p className="text-muted-foreground">
          {error ? getErrorMessage(error) : 'Cooperative not found.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/admin/cooperatives')}>
          {t('cooperatives.detail.backToList')}
        </Button>
      </div>
    );
  }

  const isDeleted = Boolean(c.deletedAt);
  const statusBucket = isDeleted ? 'deleted' : c.isActive ? 'active' : 'inactive';
  const statusTone = {
    active: 'bg-green-100 text-green-600',
    inactive: 'bg-red-50 text-red-600',
    deleted: 'bg-gray-100 text-gray-500',
  }[statusBucket];

  // Compact card overrides — same as farmer-detail.
  const CARD_CLASS = 'py-0 gap-0';
  const CARD_HEADER_CLASS = 'px-4 pt-4 pb-2 gap-1';
  const CARD_CONTENT_CLASS = 'px-4 pb-4';
  const ROW_CLASS = 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4';

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <BackButton fallbackTo="/admin/cooperatives" />
              <h1 className="font-semibold text-2xl text-foreground">
                {t('cooperatives.detail.title')}
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">{t('cooperatives.detail.subtitle')}</p>
          </div>
          {!isDeleted && (
            <PermissionGate codes={['cooperative:update']}>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                {t('cooperatives.dialog.editSubmit')}
              </Button>
            </PermissionGate>
          )}
        </div>

        <ErrorBanner message={pageError} />

        {/* Profile card — building avatar + name + status pills, with a
            sub-row of "<district> · <farmer count>". No card header,
            no shadow — matches Pencil `dyWMT` (border only, p-3). */}
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
            <Building2 className="size-5 text-muted-foreground" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[15px] text-foreground">{c.name}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}
              >
                {t(`cooperatives.status.${statusBucket}`)}
              </span>
              {c.certifiedFarmerCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-600">
                  <BadgeCheck className="size-3" />
                  {t('cooperatives.detail.raCertified')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span>{c.districtName ?? '—'}</span>
              <span>·</span>
              <span>
                {intl.formatMessage(
                  { id: 'cooperatives.detail.farmersCount' },
                  { count: c.farmerCount },
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Chair & Contact */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <Contact className="size-4 text-muted-foreground" />
              {t('cooperatives.detail.chairContact')}
            </CardTitle>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className="flex flex-col gap-3">
              <div className={ROW_CLASS}>
                <InfoField
                  label={t('cooperatives.detail.coopChair')}
                  value={
                    c.chairFullName ?? (
                      <span className="text-muted-foreground">
                        {t('cooperatives.field.chairNone')}
                      </span>
                    )
                  }
                />
                <InfoField
                  label={t('cooperatives.detail.contactEmail')}
                  value={c.contactEmail ?? '—'}
                />
              </div>
              <InfoField
                label={t('cooperatives.detail.description')}
                value={c.description ?? '—'}
                weight="normal"
              />
              <InfoField
                label={t('cooperatives.field.address')}
                value={c.address ?? '—'}
                weight="normal"
              />
            </div>
          </CardContent>
        </Card>

        {/* Certification */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="size-4 text-muted-foreground" />
              {t('cooperatives.detail.certification')}
            </CardTitle>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className="flex flex-col gap-3">
              <div className={ROW_CLASS}>
                <InfoField
                  label={t('cooperatives.detail.certifiedFarmers')}
                  value={
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-green-600">{c.certifiedFarmerCount}</span>
                      {c.certifiedFarmerCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-600">
                          <BadgeCheck className="size-3" />
                          {t('cooperatives.detail.raCertified')}
                        </span>
                      )}
                    </div>
                  }
                />
                <InfoField
                  label={t('cooperatives.detail.notCertified')}
                  value={
                    <span className="font-medium text-red-600">
                      {Math.max(0, c.farmerCount - c.certifiedFarmerCount)}
                    </span>
                  }
                />
              </div>
              <div className={ROW_CLASS}>
                <InfoField
                  label={t('cooperatives.detail.certificationRate')}
                  value={<span className="font-semibold">{certificationRate(c)}</span>}
                />
                <InfoField
                  label={t('cooperatives.detail.dataConsent')}
                  value={consentDisplay(c, t)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Overview */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-muted-foreground" />
              {t('cooperatives.detail.overview')}
            </CardTitle>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className="flex flex-col gap-3">
              <div className={ROW_CLASS}>
                <InfoField label={t('cooperatives.detail.totalFarmers')} value={c.farmerCount} />
                <InfoField label={t('cooperatives.detail.totalFields')} value={c.fieldCount} />
              </div>
              <div className={ROW_CLASS}>
                <InfoField label={t('cooperatives.detail.totalParcels')} value={c.parcelCount} />
                <InfoField label={t('cooperatives.detail.totalArea')} value={totalAreaDisplay(c)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users with access — explicit assignments from
            `iam.user_cooperative_assignments` PLUS org-wide admins
            (`users.is_all_cooperative`). Org-wide rows render with
            an "Org-wide" badge and no remove button since there's
            nothing coop-specific to un-assign on them. */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="size-4 text-muted-foreground" />
              {t('cooperatives.detail.members')}
            </CardTitle>
            <CardDescription>{t('cooperatives.detail.membersDescription')}</CardDescription>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            {membersLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : !members || members.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {t('cooperatives.detail.membersEmpty')}
              </span>
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {m.name}
                        </span>
                        {/* Chair badge — coop's designated contact
                            (cooperative.chairUserId). Short label keeps
                            the row visually quiet next to the org-wide
                            tag and the role chips. */}
                        {c.chairUserId === m.userId && (
                          <span
                            className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                            title={t('cooperatives.detail.memberChairTooltip')}
                          >
                            {t('cooperatives.detail.memberChairBadge')}
                          </span>
                        )}
                        {/* Org-wide tag — surfaces WHY this user shows
                            up on every coop's member list. Same muted
                            badge treatment as the role chips so it
                            reads as metadata, not an action. */}
                        {m.viaOrgWide && (
                          <span
                            className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                            title={t('cooperatives.detail.memberOrgWideTooltip')}
                          >
                            {t('cooperatives.detail.memberOrgWideBadge')}
                          </span>
                        )}
                      </div>
                      <a
                        href={`mailto:${m.email}`}
                        className="block truncate text-[12px] text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {m.email}
                      </a>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {m.roles.length > 0 ? (
                        m.roles.map((r) => (
                          <span
                            key={r}
                            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                          >
                            {r}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </div>
                    {/* Remove button only for explicitly-assigned users.
                        Org-wide admins have nothing coop-specific to
                        un-assign — clearing their assignment row would
                        be a no-op since the access comes from the
                        `is_all_cooperative` flag. */}
                    {!m.viaOrgWide && (
                      <PermissionGate codes={['user:update']}>
                        <button
                          type="button"
                          aria-label={t('cooperatives.detail.removeMember')}
                          title={t('cooperatives.detail.removeMember')}
                          onClick={() => handleRemoveMember(m.userId)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                        >
                          <X className="size-4" />
                        </button>
                      </PermissionGate>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Cooperative Management */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="size-4 text-muted-foreground" />
              {t('cooperatives.detail.management')}
            </CardTitle>
            <CardDescription>{t('cooperatives.detail.managementDescription')}</CardDescription>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className="flex flex-wrap gap-3">
              {!isDeleted && (
                <PermissionGate codes={['cooperative:update']}>
                  <Button variant="outline" onClick={handleToggleActive}>
                    <Ban className="size-4" />
                    {c.isActive
                      ? t('cooperatives.detail.deactivate')
                      : t('cooperatives.detail.activate')}
                  </Button>
                </PermissionGate>
              )}
              {/* Outlined red — Pencil shows the delete action as a
                  red-bordered ghost button rather than a solid
                  destructive variant. Keeps the management section
                  visually quieter while still flagging the action. */}
              <PermissionGate codes={['cooperative:delete']}>
                <Button
                  variant="outline"
                  onClick={() => setDeleteOpen(true)}
                  disabled={isDeleted}
                  className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="size-4" />
                  {t('cooperatives.deleteDialog.confirm')}
                </Button>
              </PermissionGate>
            </div>
          </CardContent>
        </Card>
      </div>

      <CooperativeDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleEdit}
        initialData={c}
      />
      <DeleteCooperativeDialog
        target={deleteOpen ? c : null}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await handleDelete();
          setDeleteOpen(false);
        }}
      />
    </>
  );
}
