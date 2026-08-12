/**
 * Synthetic farmer dataset generator (demo deliverable D3).
 *
 * Produces `farmer-dataset-2025-2026.csv` with entirely fictional,
 * programmatically-generated data — NO real farmer records are used
 * as source or template. Names are random combinations of common
 * international name components, IDs/phones/national-ID cards are
 * synthetic, and cooperatives/societies are the fictional demo set.
 *
 * Deterministic: a fixed PRNG seed means re-running yields the exact
 * same CSV, so the committed fixture is reproducible from this script.
 *
 * Run:  bun db/seed/fixtures/farmers/generate-farmers.ts
 *
 * Output columns match what `farmers-from-csv.ts` parses:
 *   Coop,Society,Producer,ProducerID,Field ID,Field,FIELD Size,
 *   DOBProducer,FarmerGender,NationalId,PurchasingClerkCard,PhoneNumber,
 *   Hhsize,NumberChildren,HHAssessed
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Deterministic PRNG (mulberry32) ───────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260724);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

// ── Fictional name + place pools ──────────────────────────────────
const MALE_FIRST = [
  'James',
  'Liam',
  'Noah',
  'Lucas',
  'Mateo',
  'Omar',
  'Chen',
  'Arjun',
  'David',
  'Daniel',
];
const FEMALE_FIRST = [
  'Maria',
  'Sofia',
  'Aisha',
  'Mei',
  'Priya',
  'Elena',
  'Sarah',
  'Fatima',
  'Anna',
  'Lucia',
];
const SURNAMES = [
  'Smith',
  'Garcia',
  'Nguyen',
  'Khan',
  'Silva',
  'Muller',
  'Rossi',
  'Kim',
  'Ivanov',
  'Andersson',
  'Costa',
  'Haddad',
  'Wang',
  'Patel',
  'Dubois',
  'Santos',
  'Fischer',
  'Reyes',
  'Novak',
  'Larsen',
];
const SOCIETY_WORDS = [
  'Riverside',
  'Hillcrest',
  'Greenvale',
  'Sunbright',
  'Lakeview',
  'Fieldstone',
  'Oakridge',
  'Meadowbrook',
  'Fairview',
  'Brookside',
  'Cedarwood',
  'Highgate',
  'Westgate',
  'Eastwood',
  'Northfield',
  'Southbank',
  'Clearwater',
  'Goldfield',
  'Silverstone',
  'Palmgrove',
];

// Cooperatives — must match db/seed/cooperatives.ts (label + code prefix).
const COOPS = [
  { label: 'Sankofa', prefix: 'SNK' },
  { label: 'Nkabom', prefix: 'NKB' },
  { label: 'Adwuma', prefix: 'ADW' },
  { label: 'Aboma', prefix: 'ABM' },
  { label: 'Ayekoo', prefix: 'AYK' },
  { label: 'Nhyira', prefix: 'NHY' },
];

// Each coop gets a random 100–120 farmers (drawn from the seeded PRNG
// so the generated CSV stays reproducible).
const FARMERS_PER_COOP_MIN = 100;
const FARMERS_PER_COOP_MAX = 120;
const SOCIETIES_PER_COOP = 5;

function nationalIdCard(): string {
  // NID-XXXXXXXXX-X (9 digits + check digit) — synthetic.
  let digits = '';
  for (let i = 0; i < 9; i++) digits += int(0, 9);
  return `NID-${digits}-${int(0, 9)}`;
}
function phone(): string {
  let n = '';
  for (let i = 0; i < 9; i++) n += int(0, 9);
  return `+1${n}`;
}

const HEADER =
  'Coop,Society,Producer,ProducerID,Field ID,Field,FIELD Size,DOBProducer,FarmerGender,NationalId,PurchasingClerkCard,PhoneNumber,Hhsize,NumberChildren,HHAssessed';

const rows: string[] = [HEADER];

for (const coop of COOPS) {
  // Distinct fictional societies for this coop.
  const societies: string[] = [];
  const usedWords = new Set<string>();
  while (societies.length < SOCIETIES_PER_COOP) {
    const w = pick(SOCIETY_WORDS);
    if (usedWords.has(w)) continue;
    usedWords.add(w);
    societies.push(`${w} Society`);
  }

  const farmerCount = int(FARMERS_PER_COOP_MIN, FARMERS_PER_COOP_MAX);
  for (let i = 1; i <= farmerCount; i++) {
    const producerId = `${coop.prefix}-${String(i).padStart(4, '0')}`;
    const isMale = rng() < 0.72;
    const first = isMale ? pick(MALE_FIRST) : pick(FEMALE_FIRST);
    const producer = `${first} ${pick(SURNAMES)}`;
    const society = pick(societies);
    const dob = int(1960, 2000);
    const gender = isMale ? 'Male' : 'Female';
    const gh = rng() < 0.6 ? nationalIdCard() : '';
    const ph = rng() < 0.7 ? phone() : '';
    const hhSize = int(1, 10);
    const children = int(0, 6);
    const hhAssessed = rng() < 0.5 ? (rng() < 0.7 ? 'Yes' : 'No') : '';

    // 1–2 fields per farmer.
    const fieldCount = rng() < 0.55 ? 1 : 2;
    for (let f = 1; f <= fieldCount; f++) {
      const fieldId = `${producerId}-F${f}`;
      const size = (0.5 + rng() * 4.5).toFixed(2);
      rows.push(
        [
          coop.label,
          society,
          producer,
          producerId,
          fieldId,
          `Field ${f}`,
          size,
          String(dob),
          gender,
          f === 1 ? gh : '', // national-ID card only on the first row (per-farmer)
          '',
          f === 1 ? ph : '',
          f === 1 ? String(hhSize) : '',
          f === 1 ? String(children) : '',
          f === 1 ? hhAssessed : '',
        ].join(','),
      );
    }
  }
}

const outPath = join(fileURLToPath(new URL('.', import.meta.url)), 'farmer-dataset-2025-2026.csv');
writeFileSync(outPath, `${rows.join('\n')}\n`, 'utf8');
console.log(`Wrote ${rows.length - 1} rows to ${outPath}`);
