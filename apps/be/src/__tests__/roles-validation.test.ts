/**
 * API endpoint validation tests for `/api/roles`. See
 * `cooperatives-validation.test.ts` for the rationale.
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
  code: `test_role_${SUFFIX}_${Date.now().toString(36)}`,
  name: 'Test Role',
});

describe('POST /api/roles — validation', () => {
  test('happy path returns 201', async () => {
    const res = await api(adminSession, 'POST', '/api/roles', VALID_CREATE());
    expect(res.status).toBe(201);
  });

  test('uppercase code → 400 ROLE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/roles', {
      ...VALID_CREATE(),
      code: 'BadRole',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('ROLE_CODE_PATTERN');
  });

  test('code starting with digit → 400 ROLE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/roles', {
      ...VALID_CREATE(),
      code: '2role',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('ROLE_CODE_PATTERN');
  });

  test('code with hyphen → 400 ROLE_CODE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/roles', {
      ...VALID_CREATE(),
      code: 'role-x',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('ROLE_CODE_PATTERN');
  });

  test('empty code → 400 ROLE_CODE_REQUIRED', async () => {
    const res = await api(adminSession, 'POST', '/api/roles', {
      ...VALID_CREATE(),
      code: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'code')).toContain('ROLE_CODE_REQUIRED');
  });

  test('empty name → 400 NAME_REQUIRED', async () => {
    const res = await api(adminSession, 'POST', '/api/roles', {
      ...VALID_CREATE(),
      name: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'name')).toContain('NAME_REQUIRED');
  });
});

describe('PATCH /api/roles/:id — validation', () => {
  let roleId: string;

  beforeAll(async () => {
    const res = await api<{ id: string }>(adminSession, 'POST', '/api/roles', VALID_CREATE());
    expect(res.status).toBe(201);
    roleId = res.data!.id;
  });

  test('empty name (when provided) → 400 NAME_REQUIRED', async () => {
    const res = await api(adminSession, 'PATCH', `/api/roles/${roleId}`, {
      name: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'name')).toContain('NAME_REQUIRED');
  });

  test('valid partial patch returns 200', async () => {
    const res = await api(adminSession, 'PATCH', `/api/roles/${roleId}`, {
      name: 'Renamed Role',
    });
    expect(res.status).toBe(200);
  });
});
