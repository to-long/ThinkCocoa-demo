/**
 * Inspection detail page. All fields render from real, typed columns
 * on `inspection.inspections` (the raw Kobo payload + snapshot-vs-master
 * comparison were removed with the Kobo decoupling). Cards:
 *   1. Summary          — form metadata
 *   2. Farmer identity  — snapshot columns
 *   3. Farm / parcel    — snapshot columns
 *   4. Traceability     — harvest / sales columns
 *   5. Training & RA    — training topics + the 5 RA-critical flags
 */

import {
  ArrowLeft,
  Building2,
  ClipboardList,
  GitCompare,
  GraduationCap,
  MapPin,
  SquareArrowOutUpRight,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { formatSociety } from '@/lib/society';
import { useInspection, useInspectionComparison } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { type CertificationTier, MAX_SCORE, tierIntlKey } from '../lib/certification';
import { CompareModal } from './compare-modal';
import { CorrectiveActionsCard } from './corrective-actions-card';
import { InspectionHeadlineTiles } from './inspection-headline-tiles';

const TIER_TONE: Record<CertificationTier, StatusTone> = {
  certified: 'success',
  certified_with_ca: 'success',
  not_certified: 'warning',
  disqualified: 'danger',
};

interface Props {
  inspectionId: string;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm text-foreground break-words">{value ?? '—'}</div>
    </div>
  );
}

/** RA-critical flag pill: '2' pass · '1' partial · '0' fail · else N/A. */
function RaCriticalRow({ label, answer }: { label: string; answer: string | null }) {
  const a = (answer ?? '').trim();
  let tone: StatusTone = 'neutral';
  let statusLabel = 'N/A';
  if (a === '2') {
    tone = 'success';
    statusLabel = 'Compliant';
  } else if (a === '1') {
    tone = 'caution';
    statusLabel = 'Partial';
  } else if (a === '0') {
    tone = 'danger';
    statusLabel = 'Non-compliant';
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <StatusTag tone={tone}>{statusLabel}</StatusTag>
    </div>
  );
}

export function InspectionDetailPageContent({ inspectionId }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  const { data: inspection, isLoading, error } = useInspection(inspectionId);
  const { data: comparison } = useInspectionComparison(inspectionId);
  const [farmerCompareOpen, setFarmerCompareOpen] = useState(false);
  const [parcelCompareOpen, setParcelCompareOpen] = useState(false);

  useBreadcrumb([
    { label: t('inspections.title'), href: '/inspections' },
    { label: inspection ? String(inspection.id) : inspectionId },
  ]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <p className="text-muted-foreground">
          {error ? (error as Error).message : t('inspections.detail.notFound')}
        </p>
        <Button variant="outline" onClick={() => navigate('/inspections')}>
          <ArrowLeft className="size-4" />
          {t('inspections.detail.backToList')}
        </Button>
      </div>
    );
  }

  const score = inspection.complianceScore ?? 0;
  const yearSeq = inspection.programYear ?? 1;
  const tier: CertificationTier = inspection.certificationOutcome ?? 'not_certified';
  const kg = (v: string | null) => (v != null ? `${Number(v).toLocaleString()} kg` : '—');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <BackButton fallbackTo="/inspections" />
              <h1 className="text-2xl font-semibold text-foreground">
                {t('inspections.detail.title')}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone="info2">
              {intl.formatMessage({ id: 'inspections.detail.chipYear' }, { year: yearSeq })}
            </StatusTag>
            <StatusTag tone={TIER_TONE[tier]}>{t(tierIntlKey(tier))}</StatusTag>
            <StatusTag tone="neutral">
              {intl.formatMessage(
                { id: 'inspections.detail.chipScore' },
                { score, max: MAX_SCORE },
              )}
            </StatusTag>
          </div>
        </div>
      </div>

      {/* 4 headline tiles + cross-field warning banner */}
      <InspectionHeadlineTiles inspection={inspection} />

      {/* Corrective actions */}
      <CorrectiveActionsCard items={inspection.followUps} />

      {/* Summary */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4 text-muted-foreground" />
            {t('inspections.detail.summary')}
          </CardTitle>
          <CardDescription>{t('inspections.detail.summaryDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t('inspections.detail.inspectionId')}
              value={<span className="font-mono text-xs">{inspection.id}</span>}
            />
            <Field
              label={t('inspections.detail.inspector')}
              value={inspection.inspectorCode ?? '—'}
            />
            <Field
              label={t('inspections.detail.society')}
              value={formatSociety(inspection.society)}
            />
            <Field
              label={t('inspections.detail.submittedAt')}
              value={new Date(inspection.submittedAt).toLocaleString()}
            />
            <Field
              label={t('inspections.detail.dateInspection')}
              value={inspection.dateInspection}
            />
            <Field
              label={t('inspections.detail.formVersion')}
              value={
                <span className="font-mono text-xs text-muted-foreground">
                  {inspection.formVersion}
                </span>
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Farmer Identity */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4 flex flex-row items-center justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4 text-muted-foreground" />
              {t('inspections.detail.farmerSection')}
            </CardTitle>
            <CardDescription>{t('inspections.detail.farmerSectionDescription')}</CardDescription>
          </div>
          <CompareTrigger section={comparison?.farmer} onClick={() => setFarmerCompareOpen(true)} />
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t('inspections.table.farmerId')}
              value={
                inspection.farmerId ? (
                  <Link
                    to={`/farmers/${encodeURIComponent(inspection.farmerId)}`}
                    className="inline-flex items-center gap-1 font-mono text-foreground hover:underline"
                  >
                    {inspection.farmerId}
                    <SquareArrowOutUpRight className="size-3.5 text-muted-foreground" />
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <Field label={t('inspections.table.farmer')} value={inspection.farmerName ?? '—'} />
            <Field label="Date of birth" value={inspection.farmerDob ?? '—'} />
            <Field label="Gender" value={inspection.farmerGender ?? '—'} />
            <Field label="National ID" value={inspection.nationalIdCard ?? '—'} />
            <Field label="Purchasing Clerk Card" value={inspection.purchasingClerkCard ?? '—'} />
            <Field label="Household size" value={inspection.householdSize ?? '—'} />
            <Field label="Children under 17" value={inspection.childrenCount ?? '—'} />
            <Field
              label="CLMRS assessed"
              value={
                inspection.clmrsAssessed == null ? '—' : inspection.clmrsAssessed ? 'Yes' : 'No'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Farm / Parcel */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4 flex flex-row items-center justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="size-4 text-muted-foreground" />
              {t('inspections.detail.parcelSection')}
            </CardTitle>
            <CardDescription>{t('inspections.detail.parcelSectionDescription')}</CardDescription>
          </div>
          <CompareTrigger section={comparison?.parcel} onClick={() => setParcelCompareOpen(true)} />
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t('inspections.table.parcelId')}
              value={
                inspection.parcelId ? (
                  <Link
                    to={`/farms/${encodeURIComponent(inspection.parcelId)}`}
                    className="inline-flex items-center gap-1 font-mono text-foreground hover:underline"
                  >
                    {inspection.parcelId}
                    <SquareArrowOutUpRight className="size-3.5 text-muted-foreground" />
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <Field
              label="Field size (ha)"
              value={
                inspection.fieldSizeHa != null ? Number(inspection.fieldSizeHa).toFixed(2) : '—'
              }
            />
            <Field label="Year established" value={inspection.yearEstablished ?? '—'} />
            <Field
              label="Farm mapped"
              value={inspection.farmMapped == null ? '—' : inspection.farmMapped ? 'Yes' : 'No'}
            />
            <Field
              label="GPS checkpoint"
              value={<span className="font-mono text-xs">{inspection.gpsLocation ?? '—'}</span>}
            />
            <Field
              label="Permanent / Temporary staff"
              value={`${inspection.permanentStaff ?? 0} / ${inspection.temporaryStaff ?? 0}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Traceability */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-muted-foreground" />
            {t('inspections.detail.traceabilitySection')}
          </CardTitle>
          <CardDescription>
            {t('inspections.detail.traceabilitySectionDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t('inspections.detail.field.society')}
              value={formatSociety(inspection.society ?? null)}
            />
            <Field
              label={t('inspections.detail.field.totalHarvest')}
              value={kg(inspection.totalHarvestKg)}
            />
            <Field
              label={t('inspections.detail.field.totalSold')}
              value={kg(inspection.totalSoldKg)}
            />
            <Field
              label={t('inspections.detail.field.nextEstimate')}
              value={kg(inspection.nextSeasonEstimateKg)}
            />
            <Field
              label={t('inspections.detail.field.anotherLbc')}
              value={
                inspection.anotherLbc ? (
                  <StatusTag tone="caution">Yes · {inspection.anotherLbcReason ?? '—'}</StatusTag>
                ) : (
                  <StatusTag tone="success">No</StatusTag>
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Training & RA-critical compliance */}
      <Card className="py-4 gap-2.5">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="size-4 text-muted-foreground" />
            {t('inspections.detail.trainingSection')}
          </CardTitle>
          <CardDescription>{t('inspections.detail.trainingSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 flex flex-col gap-2.5">
          <Field
            label={t('inspections.detail.field.trainingTopics')}
            value={
              inspection.trainingTopics ? (
                <div className="flex flex-wrap gap-1.5">
                  {inspection.trainingTopics
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((tok) => (
                      <StatusTag key={tok} tone="info">
                        {tok}
                      </StatusTag>
                    ))}
                </div>
              ) : (
                '—'
              )
            }
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <RaCriticalRow
              label={t('inspections.detail.field.childLabour')}
              answer={inspection.raChildLabour}
            />
            <RaCriticalRow
              label={t('inspections.detail.field.forcedLabour')}
              answer={inspection.raForcedLabour}
            />
            <RaCriticalRow
              label={t('inspections.detail.field.discrimination')}
              answer={inspection.raDiscrimination}
            />
            <RaCriticalRow
              label={t('inspections.detail.field.abuse')}
              answer={inspection.raAbuse}
            />
            <RaCriticalRow
              label={t('inspections.detail.field.deforestation')}
              answer={inspection.eudrNoDeforestation === true ? '2' : '0'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Compare modals — mounted at root so the dialog covers the page. */}
      <CompareModal
        open={farmerCompareOpen}
        onOpenChange={setFarmerCompareOpen}
        inspectionId={String(inspection.id)}
        section="farmer"
      />
      <CompareModal
        open={parcelCompareOpen}
        onOpenChange={setParcelCompareOpen}
        inspectionId={String(inspection.id)}
        section="parcel"
      />
    </div>
  );
}

/** Compare button + "N/M different" badge. */
function CompareTrigger({
  section,
  onClick,
}: {
  section: { diffs: number; matches: number; missing: boolean } | undefined;
  onClick: () => void;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const total = section ? section.diffs + section.matches : 0;
  const showBadge = !!section && !section.missing && section.diffs > 0;
  const disabled = !section || section.missing || section.diffs === 0;
  const title = !section
    ? t('common.loading')
    : section.missing
      ? t('inspections.compare.missingMaster')
      : section.diffs === 0
        ? t('inspections.detail.compareAllMatched')
        : undefined;
  return (
    <div className="flex items-center gap-2">
      {showBadge && (
        <StatusTag tone="caution">
          {intl.formatMessage(
            { id: 'inspections.detail.diffBadge' },
            { diffs: section!.diffs, total },
          )}
        </StatusTag>
      )}
      <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} title={title}>
        <GitCompare className="size-4" />
        {t('inspections.detail.compare')}
      </Button>
    </div>
  );
}
