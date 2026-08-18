/**
 * Farmer detail view — mirrors the Pencil `zHen4` design:
 *
 *   1. Header             — title + subtitle + Edit button (right)
 *   2. Profile card       — avatar, name, RA + status badges, code · phone
 *   3. Identity & Family  — Name, Gender/DOB, ID Type/Number, HH Size/Children
 *   4. Contact            — Phone + District/Village/Section (combined)
 *   5. Membership         — Farmer Code, Coop/Start Date, Cert ID+badge, Consent
 *   6. Farmer Management  — Delete (soft) / Restore (permission-gated)
 *
 * Household counts (size + children) live inside the Identity & Family
 * card instead of their own card — Pencil folded them in. The Parcels
 * + Audit cards + household-members sub-list from earlier revisions
 * remain dropped; parcels get their own page when GeoJSON import ships.
 */

import type { CreateFarmerInput, UpdateFarmerInput } from '@kuanadata/shared';
import {
  Check,
  Copy,
  History,
  Leaf,
  Pencil,
  Phone,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag } from '@/components/ui/status-tag';
import { PermissionGate } from '@/features/auth';
import { listRecordsForFarmer as listClmrsRecordsForFarmer } from '@/features/clmrs/lib/mock';
import { formatDate } from '@/lib/datetime';
import { formatSociety } from '@/lib/society';
import {
  deleteFarmer,
  restoreFarmer,
  updateFarmer,
  useApiErrorMessage,
  useApiSuccessToast,
  useFarmer,
  useParcelsList,
  usePurchasesList,
} from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import {
  CertificationOutcomeBadge,
  CompliancePctBadge,
  ComplianceScoreBadge,
  ProgramYearBadge,
} from './certification-outcome-badge';
import { FarmerClmrsCard } from './farmer-clmrs-card';
import { FarmerDialog } from './farmer-dialog';
import { FarmerInspectionsCard } from './farmer-inspections-card';
import { FarmerParcelsCard } from './farmer-parcels-card';

interface Props {
  farmerId: string;
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    // `min-w-0` so the field can shrink inside a 2-col grid (without
    // it, content with no wrap-points pushes the column past its
    // share). `break-all` on the value ensures even unbroken strings
    // (long IDs, codes, no-space `xxxx…`) wrap inside the card.
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm text-foreground break-all">{value ?? '—'}</div>
    </div>
  );
}

/** Small helper to render a list of parts with `—` fallbacks joined by
 *  a separator, dropping any fully-empty entries so the output never
 *  reads as `— / — / Section B`. */
function joinParts(parts: (string | null | undefined)[], sep = ' / '): string {
  const filtered = parts.map((p) => (p ?? '').trim()).filter((p) => p.length > 0);
  return filtered.length > 0 ? filtered.join(sep) : '—';
}

/** Position-preserving join for paired fields (e.g. "Gender / DOB").
 *  Empty slots render as `—` so the label still maps 1:1 with the
 *  value ("male, —" instead of "male", which hides the missing DOB). */
function joinPair(parts: (string | null | undefined)[], sep = ', '): string {
  const mapped = parts.map((p) => {
    const s = (p ?? '').trim();
    return s.length > 0 ? s : '—';
  });
  return mapped.every((p) => p === '—') ? '—' : mapped.join(sep);
}

/** Renewals window, same 90 days the farmers list and the BE filter use. */
const RENEWAL_WINDOW_DAYS = 90;

/**
 * One verdict for a certificate's expiry date, so the tile at the top of
 * the page and the card further down cannot disagree about whether a
 * farmer is certified today.
 */
function certificateValidity(expiry: string | null): {
  tone: 'success' | 'caution' | 'danger' | 'neutral';
  /** Sentence for the date line — "Valid until …" / "Expired on …". */
  dateKey: string;
  /** Colour for that line: muted while there is nothing to do, amber
   *  inside the renewals window, red once lapsed. */
  dateTone: string;
} {
  if (!expiry) {
    return {
      tone: 'neutral',
      dateKey: 'farmers.detail.raNoCertificate',
      dateTone: 'text-muted-foreground',
    };
  }
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (days < 0) {
    return { tone: 'danger', dateKey: 'farmers.detail.raExpiredOn', dateTone: 'text-destructive' };
  }
  if (days <= RENEWAL_WINDOW_DAYS) {
    return {
      tone: 'caution',
      dateKey: 'farmers.detail.raValidUntil',
      dateTone: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    tone: 'success',
    dateKey: 'farmers.detail.raValidUntil',
    dateTone: 'text-muted-foreground',
  };
}

/**
 * Expiry date plus how long the certificate still runs.
 *
 * The remaining time is the part anyone acts on, so it carries the
 * colour — red once lapsed, amber inside the renewals window, green while
 * there is nothing to do — and the date stays body text beside it.
 */
function CertificateValidity({ expiry }: { expiry: string | null }) {
  const intl = useIntl();
  if (!expiry) return <span className="text-muted-foreground">—</span>;
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  const verdict =
    days < 0
      ? { key: 'farmers.detail.raLapsedAgo', tone: 'text-destructive', n: -days }
      : days <= RENEWAL_WINDOW_DAYS
        ? { key: 'farmers.detail.raRemaining', tone: 'text-amber-600 dark:text-amber-400', n: days }
        : {
            key: 'farmers.detail.raRemaining',
            tone: 'text-emerald-600 dark:text-emerald-400',
            n: days,
          };
  return (
    <span>
      {formatDate(expiry)}{' '}
      <span className={verdict.tone}>
        ({intl.formatMessage({ id: verdict.key }, { n: verdict.n })})
      </span>
    </span>
  );
}

export function FarmerDetailPageContent({ farmerId }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();
  const getErrorMessage = useApiErrorMessage();
  const successToast = useApiSuccessToast();
  const { data: farmer, isLoading, error } = useFarmer(farmerId);
  // Farmer-level EUDR summary = how many of this farmer's parcels are
  // EUDR-compliant, out of the total. Reuses the same parcels query the
  // Parcels card runs (SWR-deduped → no extra request).
  const { data: parcelsResp } = useParcelsList({ farmerId, pageSize: 50 });
  // Deliveries — what this farmer actually sold. Three of the four tiles
  // are compliance; a page about a producer that never says how much they
  // produced is missing the commercial half of the story. pageSize 200
  // covers every farmer in the book (the busiest has a few dozen
  // purchases) so the totals are exact, not page one's.
  const { data: purchasesResp } = usePurchasesList({ farmerId, pageSize: 200 });
  const purchases = purchasesResp?.items ?? [];
  const deliveredKg = purchases.reduce((n, p) => n + (Number(p.weightKg) || 0), 0);
  const delivered = purchases.reduce((n, p) => n + (Number(p.amountReceived) || 0), 0);
  const eudrParcels = parcelsResp?.items ?? [];
  const eudrTotal = eudrParcels.length;
  const eudrCompliant = eudrParcels.filter((p) => p.eudrStatus === 'compliant').length;
  const eudrTone =
    eudrTotal === 0
      ? 'neutral'
      : eudrCompliant === eudrTotal
        ? 'success'
        : eudrCompliant > 0
          ? 'caution'
          : 'neutral';

  const t = (k: string) => intl.formatMessage({ id: k });
  const fullName = farmer ? `${farmer.firstName} ${farmer.lastName}`.trim() : '';

  useBreadcrumb([{ label: t('farmers.title'), href: '/farmers' }, { label: fullName || farmerId }]);

  // Permission gating is via <PermissionGate> in JSX below. Server
  // enforces too; hiding controls the user can't use keeps the UI
  // honest and avoids 403 toasts.

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleEdit = useCallback(
    async (data: CreateFarmerInput | UpdateFarmerInput) => {
      if (!farmer) return;
      setPageError(null);
      try {
        await updateFarmer(farmer.id, data as UpdateFarmerInput);
        successToast({
          id: 'farmers.toast.updated',
          values: { name: fullName },
        });
        setEditOpen(false);
      } catch (err) {
        setPageError(getErrorMessage(err));
        throw err;
      }
    },
    [farmer, getErrorMessage, successToast, fullName],
  );

  const handleDelete = useCallback(async () => {
    if (!farmer) return;
    setPageError(null);
    try {
      await deleteFarmer(farmer.id);
      successToast({
        id: 'farmers.toast.deleted',
        values: { name: fullName },
      });
      navigate('/farmers');
    } catch (err) {
      setPageError(getErrorMessage(err));
    }
  }, [farmer, navigate, getErrorMessage, successToast, fullName]);

  const handleRestore = useCallback(async () => {
    if (!farmer) return;
    setPageError(null);
    try {
      await restoreFarmer(farmer.id);
      successToast({
        id: 'farmers.toast.restored',
        values: { name: fullName },
      });
      setRestoreOpen(false);
    } catch (err) {
      setPageError(getErrorMessage(err));
    }
  }, [farmer, getErrorMessage, successToast, fullName]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!farmer) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <p className="text-muted-foreground">
          {error ? getErrorMessage(error) : 'Farmer not found.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/farmers')}>
          {t('farmers.detail.backToList')}
        </Button>
      </div>
    );
  }

  const initials = [farmer.firstName, farmer.lastName]
    .filter(Boolean)
    .map((n) => n[0]!.toUpperCase())
    .join('');
  const isDeleted = Boolean(farmer.deletedAt);

  const consentLabel = (() => {
    if (farmer.dataCollectionConsent === true) return t('farmers.consent.yes');
    if (farmer.dataCollectionConsent === false) return t('farmers.consent.no');
    return t('farmers.consent.unknown');
  })();

  // Combined-field values for the 2-col cards. Computed here (not in
  // JSX) so the "all missing → —" fallback lives in one place.
  const combinedName = joinParts([farmer.firstName, farmer.otherNames, farmer.lastName], ' ');
  const combinedGenderDob = joinPair([
    farmer.sex,
    farmer.dateOfBirth ? formatDate(farmer.dateOfBirth) : null,
  ]);
  const combinedDistrictSociety = joinPair([
    farmer.districtName,
    farmer.society ? formatSociety(farmer.society) : null,
  ]);
  // National-ID type is a free-text field on the BE (only 'national_id'
  // in current data). Route it through intl so `national_id` → "National
  // ID" for display; unknown values fall through to a de-snaked,
  // title-cased fallback so a future 'voter_id' still renders sanely
  // even before its intl key ships.
  const nationalIdTypeLabel = farmer.nationalIdType
    ? intl.formatMessage({
        id: `farmers.nationalIdType.${farmer.nationalIdType}`,
        defaultMessage: farmer.nationalIdType
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
      })
    : null;
  const combinedIdTypeNumber = joinPair([nationalIdTypeLabel, farmer.nationalIdNumber]);
  const combinedHouseholdChildren = joinPair([
    farmer.householdSize != null ? String(farmer.householdSize) : null,
    farmer.childrenCount != null ? String(farmer.childrenCount) : null,
  ]);

  // Shared compact styles for the info cards. The stock `<Card>` ships
  // with `py-6 gap-6` + `px-6` padding which leaves a lot of empty
  // space on an info-dense read-only view — Pencil mock reads much
  // tighter. Centralizing the overrides here keeps every card on the
  // page visually consistent and makes future tuning a one-line edit.
  const CARD_CLASS = 'py-4 gap-3';
  const CARD_HEADER_CLASS = 'px-4';
  const CARD_CONTENT_CLASS = 'px-4';
  const GRID_CLASS = 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4';

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Page header — title + subtitle on the left, Edit button on
            the right. Pencil uses the generic "manage profile" copy,
            not the coop · code summary the old revision had. */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <BackButton fallbackTo="/farmers" />
              <h1 className="font-semibold text-2xl text-foreground">
                {t('farmers.detail.title')}
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">{t('farmers.detail.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Deep-link to the audit feed pre-pinned to THIS farmer.
                `entityId` alone is enough to narrow the result set to
                this one record — the audit page renders a dismissable
                chip so the admin can see why the result set is narrow
                and one-click broaden it. */}
            <PermissionGate codes={['farmer:notification']}>
              <Button variant="outline" asChild>
                <Link to={`/notifications?entityId=${encodeURIComponent(farmerId)}`}>
                  <History className="size-4" />
                  {t('common.history')}
                </Link>
              </Button>
            </PermissionGate>
            {!isDeleted && (
              <PermissionGate codes={['farmer:update']}>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4" />
                  {t('farmers.actions.edit')}
                </Button>
              </PermissionGate>
            )}
          </div>
        </div>

        <ErrorBanner message={pageError} />

        {/* Profile card — avatar + name + RA + status badges, with
            code · phone on a second line. */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <Avatar className="size-12 shrink-0">
            <AvatarFallback className="bg-muted font-semibold text-foreground">
              {initials || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-all font-semibold text-base text-foreground">
                {fullName || '—'}
              </span>
              {isDeleted ? (
                <StatusTag tone="neutral" dot>
                  {t('farmers.status.deleted')}
                </StatusTag>
              ) : (
                <StatusTag tone="success" dot>
                  {t('farmers.status.active')}
                </StatusTag>
              )}
              {farmer.latestCertification?.outcome && (
                <CertificationOutcomeBadge outcome={farmer.latestCertification.outcome} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusTag tone="neutral">
                <span className="font-mono">{farmer.farmerCode}</span>
              </StatusTag>
              {farmer.phoneNumber && (
                <StatusTag tone="info">
                  <Phone className="size-3" />
                  <a
                    href={`tel:${farmer.phoneNumber.replace(/\s+/g, '')}`}
                    className="hover:underline"
                  >
                    {farmer.phoneNumber}
                  </a>
                </StatusTag>
              )}
            </div>
          </div>
        </div>

        {/* Quick-glance tile row — Phone, ID, RA cert, CLMRS. Same
            icon-forward layout for all four so the header reads as a
            scannable dashboard rather than a form. */}
        {(() => {
          const clmrsRecords = listClmrsRecordsForFarmer(farmerId);
          const clmrsOpen = clmrsRecords.filter((r) => r.case?.status === 'open').length;
          const clmrsFlagged = clmrsRecords.filter((r) => !r.case).length;
          const clmrsHasCase = clmrsRecords.some((r) => r.case);
          const clmrsTone = clmrsOpen > 0 ? 'danger' : clmrsFlagged > 0 ? 'caution' : 'neutral';
          // Certificate validity, shared by the tile above and the card
          // below so the two can never disagree.
          const certValidity = certificateValidity(farmer.raExpiryDate);
          return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* The tile answers "can this farmer sell as certified
                  today?", so it carries the certificate's VALIDITY, not
                  the audit outcome — "Certified" beside a lapsed
                  certificate is the contradiction this page used to
                  print. The audit outcome keeps its place in the RA
                  Certification card below, where the score and program
                  year give it context. */}
              <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
                <StatusTag tone={certValidity.tone} variant="icon">
                  <ShieldCheck className="size-5" />
                </StatusTag>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t('farmers.detail.certificationCard')}
                  </span>
                  {/* The chip states the audit's verdict — the certificate's
                      real status, "Certified with CA" and not a paraphrase.
                      Validity moves to the line under it, where the colour
                      carries the urgency. */}
                  <span className="inline-flex py-0.5">
                    <CertificationOutcomeBadge
                      outcome={farmer.latestCertification?.outcome ?? null}
                    />
                  </span>
                  {farmer.raExpiryDate ? (
                    <span className={`text-xs ${certValidity.dateTone}`}>
                      {intl.formatMessage(
                        { id: certValidity.dateKey },
                        { date: formatDate(farmer.raExpiryDate) },
                      )}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
                <StatusTag tone={clmrsTone} variant="icon">
                  <ShieldAlert className="size-5" />
                </StatusTag>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t('farmers.detail.clmrs')}
                  </span>
                  {clmrsRecords.length === 0 ? (
                    <span className="text-muted-foreground text-sm">
                      {t('farmers.detail.clmrsEmptyShort')}
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {clmrsOpen > 0 && (
                        <StatusTag tone="danger">
                          {intl.formatMessage(
                            { id: 'farmers.detail.clmrsOpenCount' },
                            { n: clmrsOpen },
                          )}
                        </StatusTag>
                      )}
                      {clmrsFlagged > 0 && (
                        <StatusTag tone="caution">
                          {intl.formatMessage(
                            { id: 'farmers.detail.clmrsPendingCount' },
                            { n: clmrsFlagged },
                          )}
                        </StatusTag>
                      )}
                      {clmrsOpen === 0 && clmrsFlagged === 0 && clmrsHasCase && (
                        <span className="text-muted-foreground text-sm">
                          {t('farmers.detail.clmrsAllClosed')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
                <StatusTag tone={eudrTone} variant="icon">
                  <Leaf className="size-5" />
                </StatusTag>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t('farmers.detail.eudr')}
                  </span>
                  {eudrTotal > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <StatusTag tone={eudrTone}>
                        {eudrCompliant}/{eudrTotal}
                      </StatusTag>
                      <span className="text-muted-foreground text-xs">
                        {t('farmers.detail.eudrParcelsCompliant')}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </div>
              </div>

              {/* Replaced the shade-survival tile, which read "—" for most
                  farmers because shade profiles are collected per parcel
                  and only sporadically. */}
              <div className="flex flex-row-reverse items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
                <StatusTag tone="info" variant="icon">
                  <Scale className="size-5" />
                </StatusTag>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {t('farmers.detail.delivered')}
                  </span>
                  {purchases.length === 0 ? (
                    <span className="text-muted-foreground text-sm">
                      {t('farmers.detail.deliveredNone')}
                    </span>
                  ) : (
                    <>
                      <span className="font-semibold text-base text-foreground">
                        {intl.formatNumber(deliveredKg, { maximumFractionDigits: 0 })} kg
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {intl.formatMessage(
                          { id: 'farmers.detail.deliveredSummary' },
                          {
                            n: purchases.length,
                            amount: intl.formatNumber(delivered, {
                              maximumFractionDigits: 0,
                            }),
                          },
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Farmer profile — Identity + household + membership block.
            Phone + ID have been lifted out into the tile cards above
            so they read at a glance. */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4 text-muted-foreground" />
              {t('farmers.detail.profile')}
            </CardTitle>
            <CardDescription>{t('farmers.detail.profileDescription')}</CardDescription>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className={GRID_CLASS}>
              <InfoField label={t('farmers.field.name')} value={combinedName} />
              <InfoField label={t('farmers.field.genderDob')} value={combinedGenderDob} />
              <InfoField
                label={t('farmers.field.farmerCode')}
                value={
                  <span className="flex items-center gap-1.5">
                    <StatusTag tone="neutral">
                      <span className="font-mono">{farmer.farmerCode}</span>
                    </StatusTag>
                    <CopyValueButton value={farmer.farmerCode} />
                  </span>
                }
              />
              <InfoField
                label={t('farmers.field.phone')}
                value={
                  farmer.phoneNumber ? (
                    <span className="flex items-center gap-1.5">
                      <StatusTag tone="info">
                        <Phone className="size-3" />
                        <a
                          href={`tel:${farmer.phoneNumber.replace(/\s+/g, '')}`}
                          className="hover:underline"
                        >
                          {farmer.phoneNumber}
                        </a>
                      </StatusTag>
                      <CopyValueButton value={farmer.phoneNumber} />
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <InfoField
                label={t('farmers.field.idTypeNumber')}
                value={
                  combinedIdTypeNumber ? (
                    <span className="flex items-center gap-1.5">
                      <StatusTag tone="info2">{combinedIdTypeNumber}</StatusTag>
                      {farmer.nationalIdNumber && (
                        <CopyValueButton value={farmer.nationalIdNumber} />
                      )}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
            </div>
            <div className="my-4 border-t" />
            <div className={GRID_CLASS}>
              <InfoField
                label={t('farmers.field.householdSizeChildren')}
                value={combinedHouseholdChildren}
              />
              <InfoField
                label={t('farmers.field.districtSociety')}
                value={combinedDistrictSociety}
              />
              <InfoField
                label={t('farmers.field.startDate')}
                value={farmer.registrationDate ? formatDate(farmer.registrationDate) : '—'}
              />
              <InfoField
                label={t('farmers.field.dataCollectionConsent')}
                value={
                  farmer.dataCollectionConsent === true ? (
                    <StatusTag tone="success">{consentLabel}</StatusTag>
                  ) : (
                    consentLabel
                  )
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Certification — most-recent inspection outcome + score +
            program year. Split out of Membership per design so the
            certification signal has its own scannable block. */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-muted-foreground" />
              {t('farmers.detail.certificationCard')}
            </CardTitle>
            <CardDescription>{t('farmers.detail.certificationCardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className={GRID_CLASS}>
              <InfoField
                label={t('farmers.detail.certification')}
                value={
                  farmer.latestCertification ? (
                    <CertificationOutcomeBadge outcome={farmer.latestCertification.outcome} />
                  ) : (
                    <span className="text-muted-foreground">
                      {t('farmers.detail.latestCertificationNone')}
                    </span>
                  )
                }
              />
              <InfoField
                label={t('farmers.detail.certificationScore')}
                value={
                  <ComplianceScoreBadge
                    score={farmer.latestCertification?.complianceScore ?? null}
                  />
                }
              />
              <InfoField
                label={t('farmers.detail.certificationPct')}
                value={
                  <CompliancePctBadge pct={farmer.latestCertification?.compliancePct ?? null} />
                }
              />
              <InfoField
                label={t('farmers.detail.programYear')}
                value={
                  <ProgramYearBadge programYear={farmer.latestCertification?.programYear ?? null} />
                }
              />
              {/* The certificate itself, below the audit result that
                  produced it. The four fields an auditor or buyer asks
                  for: which certificate, who issued it, when, and how
                  long it still runs. */}
              <InfoField
                label={t('farmers.detail.raCertificateNumber')}
                value={
                  farmer.raCertificateNumber ? (
                    <span className="font-mono">{farmer.raCertificateNumber}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('farmers.detail.raNoCertificate')}
                    </span>
                  )
                }
              />
              <InfoField
                label={t('farmers.detail.raCertifyingBody')}
                value={farmer.raCertifyingBody ?? '—'}
              />
              <InfoField
                label={t('farmers.detail.raAuditDate')}
                value={farmer.raAuditDate ? formatDate(farmer.raAuditDate) : '—'}
              />
              <InfoField
                label={t('farmers.detail.raExpiryDate')}
                value={<CertificateValidity expiry={farmer.raExpiryDate} />}
              />
            </div>
          </CardContent>
        </Card>

        {/* Parcels — list of farm fields owned by this farmer. Card
            self-gates on `parcel:read` and short-circuits the SWR
            fetch when the user lacks the permission. */}
        <FarmerParcelsCard
          farmerId={farmerId}
          shadeSurvivalPct={farmer.shadeSurvivalPct}
          cardClass={CARD_CLASS}
          cardHeaderClass={CARD_HEADER_CLASS}
          cardContentClass={CARD_CONTENT_CLASS}
        />

        {/* Inspections — Kobo-sourced field audits for this farmer.
            Self-gated on `inspection:read`; a farmer with no
            inspections yet shows an empty-state icon rather than a
            missing card so ops know the table is intentional. */}
        <FarmerInspectionsCard
          farmerId={farmerId}
          cardClass={CARD_CLASS}
          cardHeaderClass={CARD_HEADER_CLASS}
          cardContentClass={CARD_CONTENT_CLASS}
        />

        {/* CLMRS — hazardous-work flags + open/closed cases across
            this farmer's children. Data ingest from Kobo Modules
            B/C/D. Card is quiet (single muted line) when the farmer
            has zero observations. */}
        <FarmerClmrsCard
          farmerId={farmerId}
          cardClass={CARD_CLASS}
          cardHeaderClass={CARD_HEADER_CLASS}
          cardContentClass={CARD_CONTENT_CLASS}
        />

        {/* Farmer Management — status-gated action matrix. */}
        <Card className={CARD_CLASS}>
          <CardHeader className={CARD_HEADER_CLASS}>
            <CardTitle className="text-base">{t('farmers.detail.farmerManagement')}</CardTitle>
            <CardDescription>{t('farmers.detail.farmerManagementDescription')}</CardDescription>
          </CardHeader>
          <CardContent className={CARD_CONTENT_CLASS}>
            <div className="flex flex-wrap gap-2">
              {isDeleted ? (
                // Restore is gated by `farmer:delete` since it toggles
                // the same `deletedAt` column.
                <PermissionGate codes={['farmer:delete']}>
                  <Button onClick={() => setRestoreOpen(true)}>
                    <RotateCcw className="size-4" />
                    {t('farmers.actions.restore')}
                  </Button>
                </PermissionGate>
              ) : (
                <PermissionGate codes={['farmer:delete']}>
                  <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="size-4" />
                    {t('farmers.actions.delete')}
                  </Button>
                </PermissionGate>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      <FarmerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleEdit}
        initialData={farmer}
      />

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">{t('farmers.deleteDialog.title')}</h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage({ id: 'farmers.deleteDialog.description' }, { name: fullName })}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('farmers.deleteDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <ShieldAlert className="size-4" />
              {t('farmers.deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirm */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">{t('farmers.restoreDialog.title')}</h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage({ id: 'farmers.restoreDialog.description' }, { name: fullName })}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreOpen(false)}>
              {t('farmers.restoreDialog.cancel')}
            </Button>
            <Button onClick={handleRestore}>{t('farmers.restoreDialog.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Inline copy-to-clipboard button — 24px icon that flashes a check
 * for 1.5s after a successful write. Used inside the Phone + ID
 * tile cards so admins can pull the value into another tool in one
 * click without selecting text.
 */
function CopyValueButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API is unavailable in insecure contexts; ignore
      // rather than surface an error — user can still select+copy.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy"
      title="Copy"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}
