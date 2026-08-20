/**
 * Daily CLMRS follow-up reminder scan.
 *
 * Emails the case CREATOR 5 days before a case's `follow_up_date`. Run once
 * a day from an OS cron on the droplet (NOT an in-process timer — blue-green
 * runs two BE instances during a deploy and both would fire):
 *
 *   0 7 * * *  cd /opt/kuanadata/apps/be && bun scripts/send-clmrs-reminders.ts
 *
 * Design (see also db/drizzle/0014_clmrs_case_reminder.sql):
 *   - The schedule IS `clmrs.cases.follow_up_date` — no separate job table
 *     to drift out of sync when a case is rescheduled.
 *   - `reminder_sent_at` is the idempotency stamp. The claim is an atomic
 *     `UPDATE ... WHERE reminder_sent_at IS NULL RETURNING`, so even if two
 *     instances (or two runs) overlap, each case is claimed once.
 *   - A `<=` window (not `= T-5`) catches a day the scan was skipped.
 *   - On a send failure the stamp is rolled back so the next run retries.
 *   - Day-granularity is deliberate: a "5 days before" reminder needs no
 *     sub-day precision, so a daily scan beats a queue (and needs no Redis).
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { clmrsCases } from '../src/db/schema/clmrs';
import { coachingVisits } from '../src/db/schema/coaching';
import { farmers } from '../src/db/schema/farmer';
import { users } from '../src/db/schema/iam';
import { renderClmrsReminderEmail, sendEmail } from '../src/lib/email';

const LEAD_DAYS = 5;

/** FE origin for the case deep-link. `FE_URL` may be a comma-separated
 *  allowlist (see auth.ts); the first entry is the canonical origin. */
const FE_ORIGIN = (process.env.FE_URL ?? process.env.BETTER_AUTH_URL ?? '')
  .split(',')[0]
  .trim()
  .replace(/\/$/, '');

/** `YYYY-MM-DD` → `DD-MM-YYYY` (matches the app-wide date format). */
function toDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

const todayIso = new Date().toISOString().slice(0, 10);

// Cases whose follow-up is within the next LEAD_DAYS (reached the T-5 mark
// but not yet passed), still open, not yet reminded, and with a resolvable
// creator email.
const due = await db
  .select({
    id: clmrsCases.id,
    clmrsCode: clmrsCases.clmrsCode,
    childId: clmrsCases.childId,
    followUpDate: clmrsCases.followUpDate,
    creatorEmail: users.email,
    creatorName: users.name,
    farmerFirst: farmers.firstName,
    farmerLast: farmers.lastName,
  })
  .from(clmrsCases)
  .innerJoin(users, eq(users.id, clmrsCases.createdBy))
  // child_id is text; coaching_visits.id is uuid — cast to compare.
  .leftJoin(coachingVisits, eq(clmrsCases.childId, sql`${coachingVisits.id}::text`))
  .leftJoin(farmers, eq(farmers.id, coachingVisits.farmerId))
  .where(
    sql`${clmrsCases.status} <> 'closed'
      AND ${clmrsCases.followUpDate} IS NOT NULL
      AND ${clmrsCases.reminderSentAt} IS NULL
      AND ${clmrsCases.followUpDate}::date - ${sql.raw(`INTERVAL '${LEAD_DAYS} days'`)} <= now()::date
      AND ${clmrsCases.followUpDate}::date > now()::date`,
  );

console.log(`[clmrs-reminders] ${todayIso}: ${due.length} case(s) due within ${LEAD_DAYS} days`);

let sent = 0;
let skipped = 0;
for (const row of due) {
  const followUpIso = row.followUpDate as string;

  // Atomic claim: only the caller that flips reminder_sent_at from NULL
  // actually sends. Guards against overlapping runs / two instances.
  const claimed = await db
    .update(clmrsCases)
    .set({ reminderSentAt: sql`now()` })
    .where(sql`${clmrsCases.id} = ${row.id} AND ${clmrsCases.reminderSentAt} IS NULL`)
    .returning({ id: clmrsCases.id });
  if (claimed.length === 0) {
    skipped += 1;
    continue;
  }

  const farmerName = [row.farmerFirst, row.farmerLast].filter(Boolean).join(' ').trim() || '—';
  const daysUntil = Math.max(0, daysBetween(todayIso, followUpIso));
  const url = `${FE_ORIGIN}/clmrs/${encodeURIComponent(row.childId)}`;
  const mail = renderClmrsReminderEmail({
    recipientName: row.creatorName,
    clmrsCode: row.clmrsCode,
    farmerName,
    followUpDate: toDMY(followUpIso),
    daysUntil,
    url,
  });

  const ok = await sendEmail({
    to: row.creatorEmail,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (ok) {
    sent += 1;
    console.log(`[clmrs-reminders] sent ${row.clmrsCode} → ${row.creatorEmail} (T-${daysUntil})`);
  } else {
    // Roll the stamp back so the next daily run retries this one.
    await db.update(clmrsCases).set({ reminderSentAt: null }).where(eq(clmrsCases.id, row.id));
    console.error(
      `[clmrs-reminders] send FAILED (will retry) ${row.clmrsCode} → ${row.creatorEmail}`,
    );
  }
}

console.log(`[clmrs-reminders] done: ${sent} sent, ${skipped} already-claimed/skipped`);
process.exit(0);
