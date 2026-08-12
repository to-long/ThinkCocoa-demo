/**
 * Farmer CSV export — the reverse of `csv-import.ts`. Emits the exact
 * 2025-2026 "Farmer Dataset" column layout (see
 * `docs/Farmer Dataset 2025-2026 - June2026(data).csv`) so an export
 * round-trips back through the importer.
 *
 * One row per farmer×parcel (the source sheet is farmer-field grained):
 * a farmer with N parcels yields N rows; a farmer with none yields one
 * row with the three Field columns blank. The filtered set is exactly
 * what the list endpoint would return for the same query params — we
 * reuse `listFarmers` (page 1, huge pageSize) so every filter (search,
 * society, cooperative, certification status, active-coop scope) is
 * honoured identically, then join parcels.
 */

import { inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { parcels } from '../../db/schema/gis';
import { type ListFarmersFilters, listFarmers } from './service';

/** Header row — verbatim column order from the source dataset. */
const HEADERS = [
  'Coop',
  'Society',
  'Producer',
  'ProducerID',
  'Field ID',
  'Field',
  'FIELD Size',
  'DOBProducer',
  'FarmerGender',
  'NationalId',
  'PurchasingClerkCard',
  'PhoneNumber',
  'Hhsize',
  'NumberChildren',
  'HHAssessed',
] as const;

/** RFC-4180 field escaping: quote when the value has a comma, quote or
 *  newline; double any embedded quotes. */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function genderLabel(sex: string | null): string {
  if (!sex) return '';
  return sex.charAt(0).toUpperCase() + sex.slice(1);
}

function boolLabel(v: boolean | null): string {
  if (v == null) return '';
  return v ? 'Yes' : 'No';
}

/** Build the CSV text for every farmer matching `filters` (all pages). */
export async function exportFarmersCsv(
  filters: Omit<ListFarmersFilters, 'page' | 'pageSize' | 'sort'>,
): Promise<string> {
  const { rows } = await listFarmers({
    ...filters,
    page: 1,
    // Export is unpaginated — pull the whole filtered set in one go.
    pageSize: 1_000_000,
  });

  // Parcels for the matched farmers, grouped by farmer id.
  const farmerIds = rows.map((r) => r.farmer.id);
  const parcelRows = farmerIds.length
    ? await db
        .select({
          id: parcels.id,
          farmerId: parcels.farmerId,
          parcelName: parcels.parcelName,
          calculatedAreaHa: parcels.calculatedAreaHa,
        })
        .from(parcels)
        .where(inArray(parcels.farmerId, farmerIds))
    : [];
  const parcelsByFarmer = new Map<string, typeof parcelRows>();
  for (const p of parcelRows) {
    if (!p.farmerId) continue;
    const list = parcelsByFarmer.get(p.farmerId) ?? [];
    list.push(p);
    parcelsByFarmer.set(p.farmerId, list);
  }

  const lines: string[] = [HEADERS.join(',')];
  for (const { farmer, coopName } of rows) {
    const producer = `${farmer.firstName} ${farmer.lastName}`.trim();
    const dobYear = farmer.dateOfBirth ? String(farmer.dateOfBirth).slice(0, 4) : '';
    const nationalId =
      farmer.nationalIdType === 'national_id' ? (farmer.nationalIdNumber ?? '') : '';
    const base = [coopName, farmer.society, producer, farmer.id];
    const tail = [
      dobYear,
      genderLabel(farmer.sex),
      nationalId,
      '', // PurchasingClerkCard — not modelled; kept as an empty column for parity
      farmer.phoneNumber,
      farmer.householdSize,
      farmer.childrenCount,
      boolLabel(farmer.hhAssessed),
    ];
    const farmerParcels = parcelsByFarmer.get(farmer.id) ?? [];
    if (farmerParcels.length === 0) {
      lines.push([...base, '', '', '', ...tail].map(csvCell).join(','));
    } else {
      for (const p of farmerParcels) {
        lines.push(
          [...base, p.id, p.parcelName, p.calculatedAreaHa, ...tail].map(csvCell).join(','),
        );
      }
    }
  }
  // Trailing newline so the file ends cleanly (POSIX text convention).
  return `${lines.join('\n')}\n`;
}
