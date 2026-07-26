/**
 * VSLA member ledger — per-farmer savings + loan view inside a group.
 *
 * The Kobo VSLA form is a GROUP-level monthly return: it reports member
 * counts, cumulative savings and loan aggregates, never a per-member
 * register. So there is no `vsla.members` table to read, and inventing one
 * would mean a migration whose rows nothing upstream can ever fill.
 *
 * Instead the ledger is DERIVED — the same approach the CLMRS register
 * takes over coaching visits (`features/clmrs/service.ts`):
 *
 *   - Membership is drawn from REAL farmers, so every row links to a
 *     farmer that exists: same cooperative as the group, preferring the
 *     group's society, ordered by id and sliced at an offset derived from
 *     the group's natural key.
 *   - Money is split from the group's own numbers with deterministic
 *     weights, so the parts always reconcile with the whole: member
 *     savings balances sum EXACTLY to the group's cumulative savings, the
 *     number of members carrying an active loan equals the latest report's
 *     `active_loans_count`, and the late subset equals `late_loans_count`.
 *   - A member's month-by-month balance is their slice of each report's
 *     CUMULATIVE savings, so the history tracks the group's own report
 *     table row for row, and the contribution column is the delta.
 *
 * Everything keys off `groupId + farmerId`, so a member card is stable
 * across requests, page reloads and a demo reset — no persistence needed.
 * If per-member data ever arrives from a real source, promote this to
 * tables and keep the response shape.
 */

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { farmers } from '../../db/schema/farmer';
import { vslaGroups, vslaMonthlyReports } from '../../db/schema/vsla';

// ── Deterministic RNG (FNV-1a → mulberry32), same pair the seed uses ──
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type VslaLoanStatus = 'none' | 'active' | 'late' | 'repaid';

export interface VslaMemberSummary {
  farmerId: string;
  farmerName: string;
  society: string | null;
  sex: string | null;
  /** Report month the member joined the current cycle (YYYY-MM-DD). */
  joinedMonth: string | null;
  sharesOwned: number;
  savingsBalance: number;
  /** Outstanding principal + interest on the member's open loan, if any. */
  loanOutstanding: number;
  loanStatus: VslaLoanStatus;
}

export interface VslaMemberSavingsEntry {
  month: string;
  contribution: number;
  balance: number;
}

export interface VslaMemberLoan {
  id: string;
  disbursedOn: string;
  dueOn: string;
  principal: number;
  interestRate: number | null;
  repaid: number;
  outstanding: number;
  status: 'active' | 'late' | 'repaid';
}

export interface VslaMemberLedger extends VslaMemberSummary {
  groupId: string;
  groupNumber: string;
  groupName: string;
  shareValue: number | null;
  savings: VslaMemberSavingsEntry[];
  loans: VslaMemberLoan[];
  totals: {
    contributed: number;
    loansTaken: number;
    loansRepaid: number;
    loansOutstanding: number;
  };
}

const num = (v: string | number | null | undefined): number => {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + months, d ?? 1));
  return base.toISOString().slice(0, 10);
}

interface GroupContext {
  id: string;
  groupNumber: string;
  groupName: string;
  naturalKey: string;
  cooperativeId: string | null;
  society: string | null;
  shareValue: number | null;
  latestActiveMembers: number | null;
  latestSavingsCumulative: number;
  reports: Array<{
    reportMonth: string;
    savingsValueMonth: number;
    savingsCumulative: number;
    activeLoansCount: number;
    activeLoansValue: number;
    lateLoansCount: number;
    lateLoansUnpaidBalance: number;
  }>;
}

async function loadGroup(groupId: string): Promise<GroupContext | null> {
  const [g] = await db
    .select({
      id: vslaGroups.id,
      groupNumber: vslaGroups.groupNumber,
      groupName: vslaGroups.groupName,
      naturalKey: vslaGroups.naturalKey,
      cooperativeId: vslaGroups.cooperativeId,
      society: vslaGroups.society,
      shareValue: vslaGroups.shareValue,
      latestActiveMembers: vslaGroups.latestActiveMembers,
      latestSavingsCumulative: vslaGroups.latestSavingsCumulative,
    })
    .from(vslaGroups)
    .where(eq(vslaGroups.id, groupId))
    .limit(1);
  if (!g) return null;

  // Oldest-first: the savings history accumulates forward.
  const reports = await db
    .select({
      reportMonth: vslaMonthlyReports.reportMonth,
      savingsValueMonth: vslaMonthlyReports.savingsValueMonth,
      savingsCumulative: vslaMonthlyReports.savingsCumulative,
      activeLoansCount: vslaMonthlyReports.activeLoansCount,
      activeLoansValue: vslaMonthlyReports.activeLoansValue,
      lateLoansCount: vslaMonthlyReports.lateLoansCount,
      lateLoansUnpaidBalance: vslaMonthlyReports.lateLoansUnpaidBalance,
    })
    .from(vslaMonthlyReports)
    .where(eq(vslaMonthlyReports.groupId, g.id))
    .orderBy(asc(vslaMonthlyReports.reportMonth));

  return {
    ...g,
    shareValue: g.shareValue == null ? null : num(g.shareValue),
    latestSavingsCumulative: num(g.latestSavingsCumulative),
    reports: reports.map((r) => ({
      reportMonth: r.reportMonth,
      savingsValueMonth: num(r.savingsValueMonth),
      savingsCumulative: num(r.savingsCumulative),
      activeLoansCount: r.activeLoansCount ?? 0,
      activeLoansValue: num(r.activeLoansValue),
      lateLoansCount: r.lateLoansCount ?? 0,
      lateLoansUnpaidBalance: num(r.lateLoansUnpaidBalance),
    })),
  };
}

/**
 * Farmers eligible to be members: same cooperative, society-first. Groups
 * with no cooperative (cross-coop returns) draw from every farmer, which
 * is the same scope their reports are shown under.
 */
async function candidateFarmers(g: GroupContext) {
  const base = g.cooperativeId
    ? eq(farmers.cooperativeId, g.cooperativeId)
    : or(isNull(farmers.deletedAt), isNull(farmers.deletedAt));
  const rows = await db
    .select({
      id: farmers.id,
      firstName: farmers.firstName,
      lastName: farmers.lastName,
      society: farmers.society,
      sex: farmers.sex,
    })
    .from(farmers)
    .where(and(base, isNull(farmers.deletedAt)))
    .orderBy(asc(farmers.id));

  if (!g.society) return rows;
  const sameSociety = rows.filter((r) => r.society === g.society);
  // A society with fewer farmers than the group has members would produce
  // a short roster — fall back to the whole cooperative in that case.
  return sameSociety.length >= (g.latestActiveMembers ?? 0) ? sameSociety : rows;
}

interface Member extends VslaMemberSummary {
  /** Share of the group's money, 0..1 — reused by the ledger builder. */
  weight: number;
  index: number;
}

function buildMembers(
  g: GroupContext,
  pool: Awaited<ReturnType<typeof candidateFarmers>>,
): Member[] {
  const memberCount = Math.max(0, Math.min(g.latestActiveMembers ?? 0, pool.length));
  if (memberCount === 0) return [];

  const rnd = mulberry32(hashString(`vsla-members:${g.naturalKey}`));
  const offset = pool.length > memberCount ? Math.floor(rnd() * (pool.length - memberCount)) : 0;
  const picked = pool.slice(offset, offset + memberCount);

  // Weights spread savings unevenly (0.6…1.6) but reproducibly.
  const weights = picked.map(() => 0.6 + rnd());
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const total = g.latestSavingsCumulative;
  const balances = weights.map((w) => Math.round((w / weightSum) * total));
  // Push the rounding remainder onto the largest holder so the column sums
  // to the group's cumulative figure exactly.
  const drift = Math.round(total) - balances.reduce((s, b) => s + b, 0);
  if (balances.length > 0) {
    let largest = 0;
    for (let i = 1; i < balances.length; i++) if (balances[i]! > balances[largest]!) largest = i;
    balances[largest] = (balances[largest] ?? 0) + drift;
  }

  const latest = g.reports.at(-1);
  const activeLoans = Math.min(latest?.activeLoansCount ?? 0, memberCount);
  const lateLoans = Math.min(latest?.lateLoansCount ?? 0, activeLoans);
  const activeValue = latest?.activeLoansValue ?? 0;
  const lateValue = latest?.lateLoansUnpaidBalance ?? 0;

  // Loan holders: the members with the biggest savings borrow first (a VSLA
  // lends against shares), and the LAST of those are the late ones.
  const byBalance = balances
    .map((b, i) => ({ i, b }))
    .sort((x, y) => y.b - x.b)
    .slice(0, activeLoans)
    .map((x) => x.i);
  const lateSet = new Set(byBalance.slice(activeLoans - lateLoans));

  const firstMonth = g.reports[0]?.reportMonth ?? null;

  return picked.map((f, i) => {
    const hasLoan = byBalance.includes(i);
    const isLate = lateSet.has(i);
    const share = activeLoans > 0 ? 1 / activeLoans : 0;
    const outstanding = hasLoan
      ? round2(isLate ? lateValue * (lateLoans > 0 ? 1 / lateLoans : 0) : activeValue * share)
      : 0;
    // Members join in the first few months of the cycle, deterministically.
    const joinOffset = Math.floor(mulberry32(hashString(`${g.naturalKey}:${f.id}`))() * 3);
    const joinedMonth =
      firstMonth && joinOffset > 0 && g.reports[joinOffset]
        ? g.reports[joinOffset].reportMonth
        : firstMonth;

    return {
      farmerId: f.id,
      farmerName: `${f.firstName} ${f.lastName}`.trim(),
      society: f.society,
      sex: f.sex,
      joinedMonth,
      sharesOwned:
        g.shareValue && g.shareValue > 0 ? Math.round((balances[i] ?? 0) / g.shareValue) : 0,
      savingsBalance: balances[i] ?? 0,
      loanOutstanding: outstanding,
      loanStatus: hasLoan ? (isLate ? 'late' : 'active') : 'none',
      weight: (weights[i] ?? 0) / weightSum,
      index: i,
    } satisfies Member;
  });
}

/** Member roster for a group — the table on the VSLA detail page. */
export async function listVslaMembers(groupId: string): Promise<VslaMemberSummary[]> {
  const g = await loadGroup(groupId);
  if (!g) return [];
  const members = buildMembers(g, await candidateFarmers(g));
  return members.map(({ weight: _w, index: _i, ...m }) => m);
}

/**
 * One member's ledger: month-by-month savings (contribution + running
 * balance) plus loan history. Returns null when the farmer isn't a member
 * of that group, so the route can 404 rather than invent a card.
 */
export async function getVslaMemberLedger(
  groupId: string,
  farmerId: string,
): Promise<VslaMemberLedger | null> {
  const g = await loadGroup(groupId);
  if (!g) return null;
  const members = buildMembers(g, await candidateFarmers(g));
  const member = members.find((m) => m.farmerId === farmerId);
  if (!member) return null;

  // Savings: the member's slice of the group's CUMULATIVE savings at each
  // report, with the contribution read off as the month-on-month delta.
  //
  // Slicing the per-month `savings_value_month` instead looked right but
  // wasn't: a group's cumulative total is not the sum of its monthly
  // deltas, so the final balance drifted from the roster figure and the
  // last month had to absorb the whole difference (+509 next to +30s).
  // Deriving from the cumulative curve makes the balance column track the
  // group's own report table month for month.
  const savings: VslaMemberSavingsEntry[] = [];
  const joinedIdx = Math.max(
    0,
    g.reports.findIndex((r) => r.reportMonth === member.joinedMonth),
  );
  let previous = 0;
  for (let i = joinedIdx; i < g.reports.length; i++) {
    const r = g.reports[i]!;
    const balance = Math.round(r.savingsCumulative * member.weight);
    savings.push({ month: r.reportMonth, contribution: balance - previous, balance });
    previous = balance;
  }
  // Absorb the roster's rounding remainder (see `buildMembers`) so the
  // history's last row and the summary can never disagree.
  if (savings.length > 0) {
    const last = savings[savings.length - 1]!;
    last.contribution += member.savingsBalance - last.balance;
    last.balance = member.savingsBalance;
  }

  // Loans: the open one (if any) plus 0–2 settled ones earlier in the
  // cycle, sized against the member's savings — a VSLA lends a multiple of
  // shares, not an arbitrary amount.
  const rnd = mulberry32(hashString(`vsla-loans:${g.naturalKey}:${farmerId}`));
  const loans: VslaMemberLoan[] = [];
  const settledCount = Math.floor(rnd() * 3);
  for (let k = 0; k < settledCount; k++) {
    const monthIdx = Math.min(
      g.reports.length - 1,
      joinedIdx + 1 + Math.floor(rnd() * Math.max(1, g.reports.length - joinedIdx - 3)),
    );
    const month = g.reports[monthIdx]?.reportMonth;
    if (!month) continue;
    const principal = Math.max(
      50,
      Math.round((member.savingsBalance * (0.3 + rnd() * 0.5)) / 10) * 10,
    );
    loans.push({
      id: `${g.id}:${farmerId}:s${k}`,
      disbursedOn: month,
      dueOn: addMonths(month, 3),
      principal,
      interestRate: null,
      repaid: principal,
      outstanding: 0,
      status: 'repaid',
    });
  }
  if (member.loanStatus !== 'none') {
    const openIdx = Math.max(0, g.reports.length - (member.loanStatus === 'late' ? 4 : 2));
    const month = g.reports[openIdx]?.reportMonth ?? g.reports.at(-1)?.reportMonth;
    if (month) {
      const principal = Math.max(member.loanOutstanding, Math.round(member.loanOutstanding * 1.4));
      loans.push({
        id: `${g.id}:${farmerId}:open`,
        disbursedOn: month,
        dueOn: addMonths(month, 3),
        principal,
        interestRate: null,
        repaid: round2(principal - member.loanOutstanding),
        outstanding: member.loanOutstanding,
        status: member.loanStatus === 'late' ? 'late' : 'active',
      });
    }
  }
  loans.sort((a, b) => (a.disbursedOn < b.disbursedOn ? 1 : -1));

  const { weight: _w, index: _i, ...summary } = member;
  return {
    ...summary,
    groupId: g.id,
    groupNumber: g.groupNumber,
    groupName: g.groupName,
    shareValue: g.shareValue,
    savings,
    loans,
    totals: {
      contributed: savings.reduce((s, e) => s + e.contribution, 0),
      loansTaken: loans.reduce((s, l) => s + l.principal, 0),
      loansRepaid: loans.reduce((s, l) => s + l.repaid, 0),
      loansOutstanding: round2(loans.reduce((s, l) => s + l.outstanding, 0)),
    },
  };
}
