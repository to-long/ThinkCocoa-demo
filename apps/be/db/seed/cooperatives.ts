/**
 * Seed the 4 demo cooperatives — idempotent. Reruns upsert by
 * `code` so column tweaks don't require a DB wipe.
 *
 * `seedCooperatives({ withChairs })` does both phases in order:
 *   1. Upsert coop rows.
 *   2. (optional) Stamp `chair_user_id` from the `chair.{coop}@…`
 *      test users — only when the test-user seed has run, since the
 *      chair user must exist first.
 *
 * All names, codes, districts, contacts and addresses below are
 * fictional demo data — they do not correspond to any real
 * cooperative, place, or organisation.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { cooperatives, users } from '../../src/db/schema/iam';

interface SeedCooperative {
  code: string;
  name: string;
  description: string;
  districtCode: string;
  districtName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

export const DEMO_COOPERATIVES: SeedCooperative[] = [
  {
    code: 'SANKOFA',
    name: 'Sankofa Cocoa Cooperative',
    description:
      'Fictional smallholder cocoa cooperative in the demo Western Zone. Operates approx. 750 active producers.',
    districtCode: 'WZ-01',
    districtName: 'Western Zone',
    contactEmail: 'sankofa@demo-cocoa.gh',
    contactPhone: '+233 30 100 0001',
    address: 'Sankofa Town, Western Zone, Ghana',
  },
  {
    code: 'NKABOM',
    name: 'Nkabom Farmers Cooperative',
    description:
      'Fictional cocoa farmer cooperative in the demo Central Zone. ~929 producers; used to showcase Rainforest Alliance certified production.',
    districtCode: 'CZ-02',
    districtName: 'Central Zone',
    contactEmail: 'nkabom@demo-cocoa.gh',
    contactPhone: '+233 31 100 0002',
    address: 'Nkabom Town, Central Zone, Ghana',
  },
  {
    code: 'ADWUMA',
    name: 'Adwuma Cocoa Union',
    description:
      'Fictional cocoa cooperative in the demo Eastern Zone. Largest of the four demo cooperatives with ~1,423 active producers.',
    districtCode: 'EZ-03',
    districtName: 'Eastern Zone',
    contactEmail: 'adwuma@demo-cocoa.gh',
    contactPhone: '+233 32 100 0003',
    address: 'Adwuma Town, Eastern Zone, Ghana',
  },
  {
    code: 'ABOMA',
    name: 'Aboma Cocoa Cooperative',
    description:
      'Fictional cocoa cooperative in the demo Southern Zone. ~1,039 producers; used to demo mining-affected smallholder coordination.',
    districtCode: 'SZ-04',
    districtName: 'Southern Zone',
    contactEmail: 'aboma@demo-cocoa.gh',
    contactPhone: '+233 33 100 0004',
    address: 'Aboma Town, Southern Zone, Ghana',
  },
  {
    code: 'AYEKOO',
    name: 'Ayekoo Cocoa Cooperative',
    description:
      'Fictional cocoa cooperative in the demo Northern Zone. Newest of the demo cooperatives; showcases onboarding a fresh coop.',
    districtCode: 'NZ-05',
    districtName: 'Northern Zone',
    contactEmail: 'ayekoo@demo-cocoa.gh',
    contactPhone: '+233 34 100 0005',
    address: 'Ayekoo Town, Northern Zone, Ghana',
  },
  {
    code: 'NHYIRA',
    name: 'Nhyira Farmers Cooperative',
    description:
      'Fictional cocoa farmer cooperative in the demo Volta Zone. Mid-sized coop used to demo cross-zone reporting.',
    districtCode: 'VZ-06',
    districtName: 'Volta Zone',
    contactEmail: 'nhyira@demo-cocoa.gh',
    contactPhone: '+233 35 100 0006',
    address: 'Nhyira Town, Volta Zone, Ghana',
  },
];

export async function seedCooperatives(db: Db, opts: { withChairs?: boolean } = {}): Promise<void> {
  console.log('  cooperatives: upserting demo cooperatives...');
  for (const c of DEMO_COOPERATIVES) {
    await db
      .insert(cooperatives)
      .values({ ...c, isActive: true })
      .onConflictDoUpdate({
        target: cooperatives.code,
        set: {
          name: c.name,
          description: c.description,
          districtCode: c.districtCode,
          districtName: c.districtName,
          contactEmail: c.contactEmail,
          contactPhone: c.contactPhone,
          address: c.address,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`    seeded ${DEMO_COOPERATIVES.length} cooperatives`);

  if (opts.withChairs) await stampChairs(db);
}

/**
 * Stamp one `cooperative_chair` test user per demo coop:
 * `chair.{coopcode}@thinkdata.com` → chair of `{COOP_CODE}`.
 * Skips silently if the chair user doesn't exist (e.g. the test-user
 * seed was disabled) — every coop falls back to chair-less. In prod
 * the chair gets reassigned via the admin UI after election.
 */
async function stampChairs(db: Db): Promise<void> {
  let assigned = 0;
  for (const c of DEMO_COOPERATIVES) {
    const chairEmail = `chair.${c.code.toLowerCase().replace(/_/g, '')}@thinkdata.com`;
    const [chair] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, chairEmail))
      .limit(1);
    if (!chair) continue;
    await db
      .update(cooperatives)
      .set({ chairUserId: chair.id })
      .where(eq(cooperatives.code, c.code));
    assigned++;
  }
  console.log(`    stamped chair on ${assigned}/${DEMO_COOPERATIVES.length} coops`);
}
