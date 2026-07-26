/**
 * VSLA schema — `vsla.*` tables. Ingest for Kobo `vsla_form`
 * (asset `aQozkwzBDbQXsWB4erJdbz`).
 *
 *   • `groups`           — 1 row per group (identity + denorm mirror of
 *                          the latest month's snapshot for cheap list
 *                          reads)
 *   • `monthlyReports`   — 1 row per Kobo submission (per group per
 *                          month). Parser upserts on `kobo_uuid`.
 *
 * DDL: `0053_vsla_schema.sql`. Not re-exported from
 * `schema/index.ts` (same convention as shade, primary-evacuation,
 * etc.) — import directly:
 *
 *   import { vslaGroups, vslaMonthlyReports } from '../../db/schema/vsla';
 */

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cooperatives } from './iam';

export const vslaSchema = pgSchema('vsla');

export const vslaGroups = vslaSchema.table(
  'groups',
  {
    id: uuid().primaryKey().defaultRandom(),

    naturalKey: text('natural_key').notNull(),

    groupNumber: text('group_number').notNull(),
    groupName: text('group_name').notNull(),
    enumeratorId: text('enumerator_id').notNull(),
    enumeratorPrefix: text('enumerator_prefix').notNull(),

    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),
    society: text(),

    communityWorkerName: text('community_worker_name'),
    shareValue: numeric('share_value', { precision: 12, scale: 2 }),
    interestFee: numeric('interest_fee', { precision: 6, scale: 2 }),

    latestReportMonth: date('latest_report_month'),
    latestActiveMembers: integer('latest_active_members'),
    latestSavingsCumulative: numeric('latest_savings_cumulative', { precision: 14, scale: 2 }),
    latestLateLoansCount: integer('latest_late_loans_count'),
    latestHasDiscrepancy: boolean('latest_has_discrepancy'),
    reportCount: integer('report_count').notNull().default(0),
    discrepancyCount: integer('discrepancy_count').notNull().default(0),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vsla_groups_natural_key_uk').on(t.naturalKey),
    index('vsla_groups_coop_idx').on(t.cooperativeId),
    index('vsla_groups_enumerator_prefix_idx').on(t.enumeratorPrefix),
    index('vsla_groups_latest_report_month_idx').on(t.latestReportMonth),
  ],
);

export const vslaMonthlyReports = vslaSchema.table(
  'monthly_reports',
  {
    id: uuid().primaryKey().defaultRandom(),

    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    groupId: uuid('group_id')
      .notNull()
      .references(() => vslaGroups.id, { onDelete: 'cascade' }),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),

    reportMonth: date('report_month').notNull(),

    activeMembersAtVisit: integer('active_members_at_visit'),
    maleMembers: integer('male_members'),
    femaleMembers: integer('female_members'),
    membersAttendingMeeting: integer('members_attending_meeting'),
    totalMembersStartCycle: integer('total_members_start_cycle'),
    numDropouts: integer('num_dropouts'),

    savingsCumulative: numeric('savings_cumulative', { precision: 14, scale: 2 }),
    savingsValueMonth: numeric('savings_value_month', { precision: 14, scale: 2 }),

    activeLoansCount: integer('active_loans_count'),
    activeLoansValue: numeric('active_loans_value', { precision: 14, scale: 2 }),
    lateLoansCount: integer('late_loans_count'),
    lateLoansUnpaidBalance: numeric('late_loans_unpaid_balance', { precision: 14, scale: 2 }),
    writeoffsValue: numeric('writeoffs_value', { precision: 14, scale: 2 }),

    cashLoanFund: numeric('cash_loan_fund', { precision: 14, scale: 2 }),
    cashSocialFund: numeric('cash_social_fund', { precision: 14, scale: 2 }),

    hasExternalLoans: boolean('has_external_loans'),
    hasExternalSavings: boolean('has_external_savings'),

    verifyLoanFundMatch: boolean('verify_loan_fund_match'),
    verifySocialFundMatch: boolean('verify_social_fund_match'),
    verifyRegisterLoanFund: boolean('verify_register_loan_fund'),
    verifyRegisterSocialFund: boolean('verify_register_social_fund'),
    hasDiscrepancy: boolean('has_discrepancy').notNull().default(false),

    comments: text(),
    gpsLocation: text('gps_location'),


    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vsla_monthly_reports_kobo_uuid_uk').on(t.koboUuid),
    index('vsla_monthly_reports_group_month_idx').on(t.groupId, t.reportMonth),
    index('vsla_monthly_reports_coop_idx').on(t.cooperativeId),
  ],
);
