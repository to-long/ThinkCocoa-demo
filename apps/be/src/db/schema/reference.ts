/**
 * Reference schema — versioned RA indicators and EUDR code sets.
 * Mirrors `reference.*` tables from migrations 011, 012.
 *
 * Seed new code-set versions in a NEW migration (do not edit existing seeds).
 * The `source_version` discriminator lets multiple revisions coexist.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const referenceSchema = pgSchema('reference');

export const raIndicator = referenceSchema.table(
  'ra_indicator',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    sourceVersion: text('source_version').notNull(),
    category: text().notNull(),
    labelEn: text('label_en').notNull(),
    labelFr: text('label_fr'),
    labelVi: text('label_vi'),
    severityDefault: text('severity_default'),
    effectiveFrom: date('effective_from').notNull(),
    retiredAt: date('retired_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ra_indicator_severity_check',
      sql`${t.severityDefault} IS NULL OR ${t.severityDefault} IN ('minor','major','critical')`,
    ),
    uniqueIndex('ra_indicator_code_version_uk').on(t.code, t.sourceVersion),
    index('idx_ra_indicator_code').on(t.code).where(sql`${t.retiredAt} IS NULL`),
  ],
);

export const eudrCountryRisk = referenceSchema.table(
  'eudr_country_risk',
  {
    id: uuid().primaryKey().defaultRandom(),
    iso2: char({ length: 2 }).notNull(),
    iso3: char({ length: 3 }),
    countryName: text('country_name').notNull(),
    riskLevel: text('risk_level').notNull(),
    sourceVersion: text('source_version').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    retiredAt: date('retired_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'eudr_country_risk_level_check',
      sql`${t.riskLevel} IN ('low','standard','high','unclassified')`,
    ),
    uniqueIndex('eudr_country_risk_uk').on(t.iso2, t.sourceVersion),
    index('idx_eudr_country_risk_iso2').on(t.iso2).where(sql`${t.retiredAt} IS NULL`),
  ],
);

export const eudrHsCode = referenceSchema.table(
  'eudr_hs_code',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    description: text().notNull(),
    cocoaScope: boolean('cocoa_scope').notNull().default(false),
    sourceVersion: text('source_version').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    retiredAt: date('retired_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('eudr_hs_code_uk').on(t.code, t.sourceVersion),
    index('idx_eudr_hs_code_scope').on(t.cocoaScope).where(sql`${t.retiredAt} IS NULL`),
  ],
);

export const eudrCommodity = referenceSchema.table(
  'eudr_commodity',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    label: text().notNull(),
    hsCodes: text('hs_codes').array().notNull().default(sql`'{}'`),
    sourceVersion: text('source_version').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    retiredAt: date('retired_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('eudr_commodity_uk').on(t.code, t.sourceVersion)],
);
