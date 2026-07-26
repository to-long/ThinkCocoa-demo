/**
 * Idempotent seed for the reference schema — RA indicators, EUDR country risk,
 * EUDR HS codes, EUDR commodities. Version 2026-04.
 *
 * Adding a new version = new seed module (don't edit this file in place).
 * Safe to run multiple times; upserts by (code, source_version).
 */

import type { Db } from '../../src/db/client';
import { eudrCommodity, eudrCountryRisk, eudrHsCode, raIndicator } from '../../src/db/schema/index';

const VERSION = '2026-04';

export async function seedReference(db: Db): Promise<void> {
  console.log('  reference: RA indicators...');
  for (const row of [
    {
      code: '1.1.1',
      category: 'Management',
      labelEn: 'Farm has management plan',
      labelFr: "L'exploitation dispose d'un plan de gestion",
      severityDefault: 'major',
    },
    {
      code: '2.1.1',
      category: 'Environment',
      labelEn: 'No deforestation after cut-off date',
      labelFr: 'Aucune déforestation après la date butoir',
      severityDefault: 'critical',
    },
    {
      code: '3.1.1',
      category: 'Labor',
      labelEn: 'No child labor (under 15)',
      labelFr: 'Aucun travail des enfants (moins de 15 ans)',
      severityDefault: 'critical',
    },
    {
      code: '4.1.1',
      category: 'Wages',
      labelEn: 'Workers paid at least minimum wage',
      labelFr: 'Les travailleurs reçoivent au moins le salaire minimum',
      severityDefault: 'major',
    },
    {
      code: '5.1.1',
      category: 'Agrochemicals',
      labelEn: 'Banned pesticides not used',
      labelFr: 'Les pesticides interdits ne sont pas utilisés',
      severityDefault: 'critical',
    },
    {
      code: '6.1.1',
      category: 'Records',
      labelEn: 'Purchase records maintained',
      labelFr: "Les registres d'achat sont tenus",
      severityDefault: 'minor',
    },
  ]) {
    await db
      .insert(raIndicator)
      .values({
        ...row,
        sourceVersion: VERSION,
        effectiveFrom: '2026-01-01',
      })
      .onConflictDoUpdate({
        target: [raIndicator.code, raIndicator.sourceVersion],
        set: {
          category: row.category,
          labelEn: row.labelEn,
          labelFr: row.labelFr,
          severityDefault: row.severityDefault,
        },
      });
  }

  console.log('  reference: EUDR country risk...');
  for (const row of [
    { iso2: 'CI', iso3: 'CIV', countryName: "Cote d'Ivoire", riskLevel: 'standard' },
    { iso2: 'GH', iso3: 'GHA', countryName: 'Ghana', riskLevel: 'standard' },
    { iso2: 'CM', iso3: 'CMR', countryName: 'Cameroon', riskLevel: 'standard' },
    { iso2: 'NG', iso3: 'NGA', countryName: 'Nigeria', riskLevel: 'standard' },
    { iso2: 'EC', iso3: 'ECU', countryName: 'Ecuador', riskLevel: 'standard' },
    { iso2: 'VN', iso3: 'VNM', countryName: 'Vietnam', riskLevel: 'low' },
    { iso2: 'PE', iso3: 'PER', countryName: 'Peru', riskLevel: 'standard' },
    { iso2: 'DO', iso3: 'DOM', countryName: 'Dominican Republic', riskLevel: 'standard' },
  ]) {
    await db
      .insert(eudrCountryRisk)
      .values({
        ...row,
        sourceVersion: VERSION,
        effectiveFrom: '2026-01-01',
      })
      .onConflictDoUpdate({
        target: [eudrCountryRisk.iso2, eudrCountryRisk.sourceVersion],
        set: {
          iso3: row.iso3,
          countryName: row.countryName,
          riskLevel: row.riskLevel,
        },
      });
  }

  console.log('  reference: EUDR HS codes...');
  for (const row of [
    { code: '1801', description: 'Cocoa beans, whole or broken, raw or roasted', cocoaScope: true },
    {
      code: '1802',
      description: 'Cocoa shells, husks, skins and other cocoa waste',
      cocoaScope: true,
    },
    { code: '1803', description: 'Cocoa paste, whether or not defatted', cocoaScope: true },
    { code: '1804', description: 'Cocoa butter, fat and oil', cocoaScope: true },
    { code: '1805', description: 'Cocoa powder, not containing added sugar', cocoaScope: true },
    {
      code: '1806',
      description: 'Chocolate and other cocoa-containing preparations',
      cocoaScope: true,
    },
  ]) {
    await db
      .insert(eudrHsCode)
      .values({
        ...row,
        sourceVersion: VERSION,
        effectiveFrom: '2026-01-01',
      })
      .onConflictDoUpdate({
        target: [eudrHsCode.code, eudrHsCode.sourceVersion],
        set: {
          description: row.description,
          cocoaScope: row.cocoaScope,
        },
      });
  }

  console.log('  reference: EUDR commodities...');
  for (const row of [
    { code: 'cocoa_beans', label: 'Cocoa beans', hsCodes: ['1801', '1802'] },
    { code: 'cocoa_paste', label: 'Cocoa paste', hsCodes: ['1803'] },
    { code: 'cocoa_butter', label: 'Cocoa butter', hsCodes: ['1804'] },
    { code: 'cocoa_powder', label: 'Cocoa powder', hsCodes: ['1805'] },
    { code: 'chocolate', label: 'Chocolate products', hsCodes: ['1806'] },
  ]) {
    await db
      .insert(eudrCommodity)
      .values({
        ...row,
        sourceVersion: VERSION,
        effectiveFrom: '2026-01-01',
      })
      .onConflictDoUpdate({
        target: [eudrCommodity.code, eudrCommodity.sourceVersion],
        set: {
          label: row.label,
          hsCodes: row.hsCodes,
        },
      });
  }

  console.log('  reference: done.');
}
