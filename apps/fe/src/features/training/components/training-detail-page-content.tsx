/**
 * Farmer Training detail — mirrors Pencil `EWFbL`.
 *
 * Layout:
 *   1. Header (program badge + session code + topics title + meta)
 *   2. 4 KPI tiles: Total / Gender split / Consent / Engagement
 *   3. Session details card (program/category/topics/timing/location)
 *   4. Attendance rate card (donut + 3 stats)
 *   5. Gender breakdown bar
 *   6. Attendance roster table (one row per farmer)
 *   7. Sidebar: trainer card · trainer evaluation · documents
 */

import {
  Calendar,
  Check,
  CircleCheck,
  Clock,
  Copy,
  GraduationCap,
  Info,
  Loader2,
  Phone,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StatusTag } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatSociety } from '@/lib/society';
import { useTrainingSession } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { FarmerRefCell } from '@/shared/components/composed/entity-ref-cell';
import { GenderDonut } from '@/shared/components/composed/gender-donut';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

interface Props {
  id: string;
}

function formatTopic(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatProgramLabel(p: string | null) {
  if (!p) return '—';
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TrainingDetailPageContent({ id }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  const { data: session, isLoading, error } = useTrainingSession(id);

  useBreadcrumb([
    { label: t('navigation.training'), href: '/training' },
    { label: session?.trainerName ?? id.slice(0, 8) },
  ]);

  if (isLoading || (!session && !error)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex flex-col items-center gap-4 p-12 text-center">
        <h2 className="font-semibold text-xl">{t('training.detail.notFound')}</h2>
        <Button variant="outline" onClick={() => navigate('/training')}>
          {t('training.detail.back')}
        </Button>
      </div>
    );
  }

  const malePct =
    session.totalParticipants && session.numMale != null
      ? Math.round((session.numMale / session.totalParticipants) * 100)
      : null;
  const femalePct =
    session.totalParticipants && session.numFemale != null
      ? Math.round((session.numFemale / session.totalParticipants) * 100)
      : null;

  const attended = session.attendance.length;
  const expectedTotal = Math.max(session.totalParticipants ?? 0, attended);
  const attendancePct = expectedTotal > 0 ? Math.round((attended / expectedTotal) * 100) : 100;

  const consent = session.consentRate;
  const rosterConsentRate =
    session.attendance.length > 0
      ? Math.round(
          (session.attendance.filter((a) => a.consent).length / session.attendance.length) * 100,
        )
      : null;
  const consentPct = rosterConsentRate ?? consent ?? null;

  const engagementBadge: Record<string, { bg: string; fg: string; label: string }> = {
    high: { bg: 'bg-emerald-50', fg: 'text-emerald-700', label: 'High' },
    medium: { bg: 'bg-yellow-50', fg: 'text-yellow-800', label: 'Medium' },
    low: { bg: 'bg-red-50', fg: 'text-red-700', label: 'Low' },
  };
  const engagement = session.participantEngagement
    ? engagementBadge[session.participantEngagement]
    : null;

  // Title shows the topic list (the Pencil header uses "Pruning ·
  // Shade trees · IPM basics"). Falls back to a generic label if no
  // topics were captured.
  const titleText = session.trainingTopics?.length
    ? session.trainingTopics.map(formatTopic).join(' · ')
    : 'Training session';

  return (
    <div className="flex flex-col gap-4">
      {/* Page title — BackButton + title + subtitle, matching the
          farmer-detail header shape. */}
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/training" />
          <h1 className="font-semibold text-2xl text-foreground">{t('training.detail.title')}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('training.detail.subtitle')}</p>
      </header>

      {/* Hero card — icon + topic title + program/id, with the session
          meta (date · time · location · trainer) as tidy tags on a
          second row. Mirrors the farmer-detail profile card. */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <StatusTag tone="info" variant="icon">
          <GraduationCap className="size-5" />
        </StatusTag>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-semibold text-base text-foreground">
              {titleText}
            </span>
            {session.program && (
              <StatusTag tone="info">{formatProgramLabel(session.program)}</StatusTag>
            )}
          </div>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
            <Calendar className="size-3" />
            {session.trainingDate}
          </span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Total participants"
          value={String(session.totalParticipants ?? 0)}
          subLabel={`${session.numMale ?? 0}M · ${session.numFemale ?? 0}F`}
          Icon={Users}
          tint="text-sky-700 bg-sky-50"
        />
        <Tile
          label="Attendance rate"
          value={`${attendancePct}%`}
          subLabel={`${attended}/${expectedTotal} attended`}
          Icon={CircleCheck}
          tint="text-emerald-700 bg-emerald-50"
        />
        <Tile
          label="Duration"
          value={
            session.durationMinutes != null
              ? session.durationMinutes >= 60
                ? `${Math.floor(session.durationMinutes / 60)}h ${session.durationMinutes % 60}m`
                : `${session.durationMinutes}m`
              : '—'
          }
          subLabel={`${session.startTime ?? '—'} → ${session.endTime ?? '—'}`}
          Icon={Clock}
          tint="text-purple-700 bg-purple-50"
        />
        <Tile
          label="Data consent"
          value={`${session.attendance.filter((a) => a.consent).length}/${session.attendance.length || session.totalParticipants || 0}`}
          subLabel={consentPct != null ? `${consentPct}% GDPR compliant` : '—'}
          Icon={ShieldCheck}
          tint="text-indigo-700 bg-indigo-50"
        />
      </div>

      <div className="flex flex-col gap-4">
        {/* Main content */}
        <div className="flex flex-col gap-4">
          {/* Session details + Trainer — one row of two cards on tablet
              and wider (each ~half width so inner fields drop to 2 cols);
              stacks to a single column on mobile. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Session details card */}
            <section className="rounded-lg border bg-card">
              <header className="p-4 pb-0">
                <h2 className="flex items-center gap-2 font-semibold text-sm">
                  <Info className="size-4 text-muted-foreground" />
                  Session details
                </h2>
              </header>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
                <FieldRow label="Program" value={formatProgramLabel(session.program)} />
                <FieldRow label="Training ID" value={String(session.koboId)} />
                <FieldRow
                  label="Participant category"
                  value={session.participantCategory?.replace(/_/g, ' ') ?? '—'}
                  capitalize
                />
                <FieldRow
                  label="Topics"
                  value={
                    session.trainingTopics?.length
                      ? session.trainingTopics.map(formatTopic).join(', ')
                      : '—'
                  }
                />
                <FieldRow
                  label="Location"
                  value={
                    [session.venue, session.society ? formatSociety(session.society) : null]
                      .filter(Boolean)
                      .join(' · ') || '—'
                  }
                />
              </div>
            </section>

            {/* Trainer card — same shell as Session details. Identity +
              phone + trainer evaluation. */}
            <section className="rounded-lg border bg-card">
              <header className="p-4 pb-0">
                <h2 className="flex items-center gap-2 font-semibold text-sm">
                  <User className="size-4 text-muted-foreground" />
                  Trainer
                </h2>
              </header>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
                <FieldRow label="Name" value={session.trainerName ?? '—'} />
                <FieldRow
                  label="Phone"
                  value={
                    session.trainerPhone ? (
                      <span className="flex items-center gap-1.5">
                        <StatusTag tone="info">
                          <Phone className="size-3" />
                          <a
                            href={`tel:${session.trainerPhone.replace(/\s+/g, '')}`}
                            className="hover:underline"
                          >
                            {session.trainerPhone}
                          </a>
                        </StatusTag>
                        <CopyValueButton value={session.trainerPhone} />
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                {session.sessionObjectivesMet != null && (
                  <FieldRow
                    label="Objectives met"
                    value={session.sessionObjectivesMet ? 'Yes' : 'No'}
                  />
                )}
                {engagement && <FieldRow label="Engagement" value={engagement.label} />}
              </div>
              {session.trainerRemarks && (
                <div className="px-4 pb-4">
                  <span className="mb-1 block text-muted-foreground text-[11px] uppercase tracking-wide">
                    Trainer comment
                  </span>
                  <p className="border-l-2 pl-2 text-muted-foreground text-xs italic">
                    "{session.trainerRemarks}"
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* Attendance rate + Gender breakdown — two donuts side by
              side, each with its legend/description below the graph. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AttendanceRate
              invited={session.totalParticipants ?? 0}
              attended={session.attendance.length}
            />
            {session.totalParticipants && session.totalParticipants > 0 && (
              <GenderDonut
                male={session.numMale ?? 0}
                female={session.numFemale ?? 0}
                malePct={malePct}
                femalePct={femalePct}
              />
            )}
          </div>

          {/* Attendance roster */}
          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between p-4 pb-0">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-sm">
                  <Users className="size-4 text-muted-foreground" />
                  Attendance roster
                </h2>
                <p className="text-muted-foreground text-xs">
                  {session.attendance.length} farmer{session.attendance.length === 1 ? '' : 's'}{' '}
                  signed in · {session.attendance.filter((a) => a.consent).length} consent captured
                </p>
              </div>
            </header>
            <div className="p-4">
              {session.attendance.length === 0 ? (
                <div className="rounded-md border border-border border-dashed bg-muted/30 px-4 py-6 text-center text-muted-foreground text-sm">
                  No farmer roster captured. Other participant types (executives, IMS, field
                  officers, inspectors) are not stored at row level yet.
                </div>
              ) : (
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted hover:bg-muted">
                        <TableHead className="sticky left-0 z-20 bg-muted">Farmer</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Gender</TableHead>
                        <TableHead>Consent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {session.attendance.map((a) => (
                        <TableRow key={a.id} className="group/row hover:bg-muted">
                          <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                            <FarmerRefCell farmerName={a.farmerName} farmerCode={a.farmerCode} />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {a.phone ?? '—'}
                          </TableCell>
                          <TableCell>
                            {a.gender ? (
                              <StatusTag tone={a.gender === 'male' ? 'info' : 'info2'}>
                                {a.gender.charAt(0).toUpperCase()}
                              </StatusTag>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {a.consent ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                                <CircleCheck className="size-3.5" />
                                Yes
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">No</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────

function CopyValueButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API is unavailable in insecure contexts; ignore.
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

function Tile({
  label,
  value,
  subLabel,
  Icon,
  tint,
}: {
  label: string;
  value: string;
  subLabel?: string;
  Icon: typeof Users;
  tint: string;
}) {
  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
        <span className="font-semibold text-2xl text-foreground">{value}</span>
        {subLabel && <span className="text-muted-foreground text-xs">{subLabel}</span>}
      </div>
      <span className={`flex h-9 w-9 items-center justify-center rounded-md ${tint}`} aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

function FieldRow({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string;
  value: ReactNode;
  capitalize?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</span>
      <span
        className={`${mono ? 'font-mono text-xs' : 'text-foreground text-sm'} ${capitalize ? 'capitalize' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function AttendanceRate({ invited, attended }: { invited: number; attended: number }) {
  // Use invited as "expected" if higher than attended (sometimes the
  // attendance totals weren't filled in pre-form, so attended is the
  // real count and pct collapses to 100).
  const expected = Math.max(invited, attended);
  const absent = Math.max(0, expected - attended);
  const pct = expected > 0 ? Math.round((attended / expected) * 100) : 100;

  // Donut: 2 stacked ellipses + center label. Using SVG so the arc
  // sweep is precise without flexbox gymnastics.
  const circumference = 2 * Math.PI * 36; // r=36
  const dashOffset = circumference * (1 - pct / 100);

  const above = pct >= 85;

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between p-4 pb-0">
        <div>
          <h2 className="font-semibold text-sm">Attendance rate</h2>
          <p className="text-muted-foreground text-xs">
            How many of the invited farmers actually showed up
          </p>
        </div>
        <StatusTag tone={above ? 'success' : 'caution'}>
          {above ? 'Above target (≥ 85%)' : 'Below target'}
        </StatusTag>
      </header>
      <div className="flex flex-col items-center gap-5 p-5">
        {/* Donut */}
        <div className="relative flex h-[160px] w-[160px] items-center justify-center">
          <svg width={160} height={160} viewBox="0 0 80 80" className="-rotate-90 absolute inset-0">
            <title>Attendance donut</title>
            <circle cx={40} cy={40} r={36} fill="none" stroke="#f1f5f9" strokeWidth={5} />
            <circle
              cx={40}
              cy={40}
              r={36}
              fill="none"
              stroke="#34d399"
              strokeWidth={5}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="z-10 flex flex-col items-center">
            <span className="font-semibold text-foreground text-3xl">{pct}%</span>
            <span className="text-muted-foreground text-[10px]">of invited</span>
          </div>
        </div>
        {/* Stat rows — below the graph */}
        <div className="flex w-full flex-col gap-3">
          <StatRow
            color="bg-sky-400"
            label="Invited"
            subLabel="expected capacity"
            value={String(expected)}
          />
          <StatRow
            color="bg-emerald-400"
            label="Attended"
            subLabel="signed in & consented"
            value={String(attended)}
          />
          <StatRow
            color="bg-slate-300"
            label="Absent"
            subLabel="no-show or excused"
            value={String(absent)}
          />
        </div>
      </div>
    </section>
  );
}

function StatRow({
  color,
  label,
  subLabel,
  value,
}: {
  color: string;
  label: string;
  subLabel: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-2.5 rounded-full ${color}`} aria-hidden />
      <div className="flex flex-1 flex-col">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{subLabel}</span>
      </div>
      <span className="font-semibold text-foreground text-lg">{value}</span>
    </div>
  );
}
