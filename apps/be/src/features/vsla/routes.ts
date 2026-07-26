/**
 * VSLA HTTP wiring.
 *   GET /api/vsla                — paginated group list (vsla:read)
 *   GET /api/vsla/stats          — 4-card stats
 *   GET /api/vsla/{id}           — single group + full monthly history
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getVslaMemberLedger, listVslaMembers } from './members';
import { getVslaGroup, getVslaStats, listVslaGroups } from './service';

export const vslaRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

vslaRoutes.use('/api/vsla', requireAuth);
vslaRoutes.use('/api/vsla/*', requireAuth);
vslaRoutes.use('/api/vsla', requireActiveCoop);
vslaRoutes.use('/api/vsla/*', requireActiveCoop);

const listQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  discrepancy: z.enum(['yes', 'no']).optional(),
  society: z.string().optional(), // CSV
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  groupNumber: z.string(),
  groupName: z.string(),
  enumeratorId: z.string(),
  enumeratorPrefix: z.string(),
  communityWorkerName: z.string().nullable(),
  cooperativeId: z.string().nullable(),
  cooperativeName: z.string().nullable(),
  cooperativeCode: z.string().nullable(),
  society: z.string().nullable(),
  latestReportMonth: z.string().nullable(),
  latestActiveMembers: z.number().nullable(),
  latestSavingsCumulative: z.number().nullable(),
  latestLateLoansCount: z.number().nullable(),
  latestHasDiscrepancy: z.boolean().nullable(),
  reportCount: z.number(),
  discrepancyCount: z.number(),
});

const listResponse = z.object({
  items: z.array(listItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const statsResponse = z.object({
  activeGroups: z.number(),
  activeMembers: z.number(),
  cumulativeSavings: z.number(),
  groupsWithDiscrepancy: z.number(),
  societies: z.array(z.string()),
});

const monthlyReport = z.object({
  id: z.string(),
  koboUuid: z.string(),
  reportMonth: z.string(),
  activeMembersAtVisit: z.number().nullable(),
  maleMembers: z.number().nullable(),
  femaleMembers: z.number().nullable(),
  savingsCumulative: z.number().nullable(),
  savingsValueMonth: z.number().nullable(),
  lateLoansCount: z.number().nullable(),
  lateLoansUnpaidBalance: z.number().nullable(),
  activeLoansCount: z.number().nullable(),
  activeLoansValue: z.number().nullable(),
  cashLoanFund: z.number().nullable(),
  cashSocialFund: z.number().nullable(),
  verifyLoanFundMatch: z.boolean().nullable(),
  verifySocialFundMatch: z.boolean().nullable(),
  verifyRegisterLoanFund: z.boolean().nullable(),
  verifyRegisterSocialFund: z.boolean().nullable(),
  hasDiscrepancy: z.boolean(),
  comments: z.string().nullable(),
  submittedAt: z.string(),
});

const detailResponse = listItem.extend({
  communityWorkerName: z.string().nullable(),
  shareValue: z.number().nullable(),
  interestFee: z.number().nullable(),
  monthlyReports: z.array(monthlyReport),
});

const errorResponse = z.object({ error: z.string() });

vslaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/vsla/stats',
    tags: ['VSLA'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('vsla:read')],
  }),
  async (c) => {
    const stats = await getVslaStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

// ── MEMBER LEDGER ────────────────────────────────────────────────
// Registered BEFORE `/{id}` so `members` in the path can't be read as a
// group id. Both routes derive their data (see `members.ts`) — the Kobo
// VSLA form is group-level, so there is no member table to read.
const memberSummarySchema = z.object({
  farmerId: z.string(),
  farmerName: z.string(),
  society: z.string().nullable(),
  sex: z.string().nullable(),
  joinedMonth: z.string().nullable(),
  sharesOwned: z.number(),
  savingsBalance: z.number(),
  loanOutstanding: z.number(),
  loanStatus: z.enum(['none', 'active', 'late', 'repaid']),
});

const memberLedgerSchema = memberSummarySchema.extend({
  groupId: z.string(),
  groupNumber: z.string(),
  groupName: z.string(),
  shareValue: z.number().nullable(),
  savings: z.array(z.object({ month: z.string(), contribution: z.number(), balance: z.number() })),
  loans: z.array(
    z.object({
      id: z.string(),
      disbursedOn: z.string(),
      dueOn: z.string(),
      principal: z.number(),
      interestRate: z.number().nullable(),
      repaid: z.number(),
      outstanding: z.number(),
      status: z.enum(['active', 'late', 'repaid']),
    }),
  ),
  totals: z.object({
    contributed: z.number(),
    loansTaken: z.number(),
    loansRepaid: z.number(),
    loansOutstanding: z.number(),
  }),
});

vslaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/vsla/{id}/members',
    tags: ['VSLA'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Member roster for the group',
        content: {
          'application/json': { schema: z.object({ items: z.array(memberSummarySchema) }) },
        },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('vsla:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    // Resolve through the scoped detail lookup first: it accepts a uuid OR
    // a group number AND enforces the active-coop scope, so the ledger
    // can't be used to read a group from another cooperative.
    const group = await getVslaGroup(id, c.get('activeCoopId'));
    if (!group) return c.json({ error: 'VSLA group not found' }, 404);
    return c.json({ items: await listVslaMembers(group.id) }, 200);
  },
);

vslaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/vsla/{id}/members/{farmerId}',
    tags: ['VSLA'],
    request: { params: z.object({ id: z.string().min(1), farmerId: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Savings + loan ledger for one member',
        content: { 'application/json': { schema: memberLedgerSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('vsla:read')],
  }),
  async (c) => {
    const { id, farmerId } = c.req.valid('param');
    const group = await getVslaGroup(id, c.get('activeCoopId'));
    if (!group) return c.json({ error: 'VSLA group not found' }, 404);
    const ledger = await getVslaMemberLedger(group.id, farmerId);
    if (!ledger) return c.json({ error: 'Farmer is not a member of this group' }, 404);
    return c.json(ledger, 200);
  },
);

vslaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/vsla/{id}',
    tags: ['VSLA'],
    // uuid OR group_number (e.g. `ABM-001`) — the service resolves both,
    // so the list can deep-link the human-facing group number.
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('vsla:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getVslaGroup(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'VSLA group not found' }, 404);
    return c.json(row, 200);
  },
);

vslaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/vsla',
    tags: ['VSLA'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('vsla:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listVslaGroups({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      discrepancy: q.discrepancy,
      societies: q.society
        ? q.society
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
