/**
 * API endpoint validation tests for `/api/cooperatives`.
 *
 * Round-trips through `app.fetch` to confirm the route + validation
 * hook + shared `createCooperativeSchema` / `updateCooperativeSchema`
 * still emit the codes the FE intl layer renders. Per `CLAUDE.md` →
 * "Validators": no schema-only parity tests; this exercises the full
 * HTTP path the dialog actually hits.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { type AuthSession, api, signInAs, TEST_USERS, uniqueSuffix } from './helpers';

let adminSession: AuthSession;
const SUFFIX = uniqueSuffix();

beforeAll(async () => {
  adminSession = await signInAs(TEST_USERS.systemAdmin.email, TEST_USERS.systemAdmin.password);
});

interface ValidationFailure {
  error: string;
  issues: Array<{ path: string; code: string }>;
}

const codesAt = (body: ValidationFailure, path: string) =>
  body.issues.filter((i) => i.path === path).map((i) => i.code);

const VALID_CREATE = () => ({
  code: `T_${SUFFIX.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`,
  farmerCodePrefix: 'TST',
  name: 'Validation Probe Coop',
});

describe('POST /api/cooperatives — validation', () => {
  test('happy path returns 201', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', VALID_CREATE());
    expect(res.status).toBe(201);
  });

  test('invalid farmerCodePrefix → 400 COOPERATIVE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      farmerCodePrefix: 'toolong9',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'farmerCodePrefix')).toContain(
      'COOPERATIVE_CODE_PATTERN',
    );
  });

  test('lowercase code → 400 COOPERATIVE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      code: 'lowercase_coop',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('COOPERATIVE_CODE_PATTERN');
  });

  test('code starting with digit → 400 COOPERATIVE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      code: '1COOP',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('COOPERATIVE_CODE_PATTERN');
  });

  test('empty name → 400 NAME_REQUIRED', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      name: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'name')).toContain('NAME_REQUIRED');
  });

  test('contactEmail malformed → 400 EMAIL_INVALID', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      contactEmail: 'not-an-email',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'contactEmail')).toContain('EMAIL_INVALID');
  });

  test('contactPhone with letters → 400 PHONE_INVALID', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      contactPhone: 'call me',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'contactPhone')).toContain('PHONE_INVALID');
  });

  test('address > 500 → 400 ADDRESS_TOO_LONG', async () => {
    const res = await api(adminSession, 'POST', '/api/cooperatives', {
      ...VALID_CREATE(),
      address: 'a'.repeat(501),
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'address')).toContain('ADDRESS_TOO_LONG');
  });
});

describe('PATCH /api/cooperatives/:id — validation', () => {
  let coopId: string;

  beforeAll(async () => {
    const res = await api<{ id: string }>(
      adminSession,
      'POST',
      '/api/cooperatives',
      VALID_CREATE(),
    );
    expect(res.status).toBe(201);
    coopId = res.data!.id;
  });

  test('lowercase code (when provided) → 400 COOPERATIVE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'PATCH', `/api/cooperatives/${coopId}`, {
      code: 'still_lower',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('COOPERATIVE_CODE_PATTERN');
  });

  test('contactEmail malformed (when provided) → 400 EMAIL_INVALID', async () => {
    const res = await api(adminSession, 'PATCH', `/api/cooperatives/${coopId}`, {
      contactEmail: 'bad',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'contactEmail')).toContain('EMAIL_INVALID');
  });

  test('valid partial patch returns 200', async () => {
    const res = await api(adminSession, 'PATCH', `/api/cooperatives/${coopId}`, {
      name: 'Renamed Coop',
    });
    expect(res.status).toBe(200);
  });
});
