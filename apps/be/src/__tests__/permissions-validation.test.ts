/**
 * API endpoint validation tests for `/api/permissions/groups`.
 *
 * The BE accepts the GROUPED record shape
 *   `{ resource: [action, action, ...] }`
 * (the FE dialog flattens its `{name, actions}` form payload to this
 * shape just before submit). Tests hit the BE shape directly to lock
 * the contract.
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

const allCodes = (body: ValidationFailure) => body.issues.map((i) => i.code);

describe('POST /api/permissions/groups — validation', () => {
  test('happy path returns 201', async () => {
    const resource = `test_resource_${SUFFIX}_${Date.now().toString(36)}`;
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {
      [resource]: ['read', 'create'],
    });
    expect(res.status).toBe(201);
  });

  test('empty object → 400 PERMISSION_GROUP_EMPTY', async () => {
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {});
    expect(res.status).toBe(400);
    expect(allCodes(res.data as ValidationFailure)).toContain('PERMISSION_GROUP_EMPTY');
  });

  test('resource with hyphen → 400 PERMISSION_GROUP_RESOURCE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {
      'bad-resource': ['read'],
    });
    expect(res.status).toBe(400);
    expect(allCodes(res.data as ValidationFailure)).toContain('PERMISSION_GROUP_RESOURCE_PATTERN');
  });

  test('resource with space → 400 PERMISSION_GROUP_RESOURCE_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {
      'bad resource': ['read'],
    });
    expect(res.status).toBe(400);
    expect(allCodes(res.data as ValidationFailure)).toContain('PERMISSION_GROUP_RESOURCE_PATTERN');
  });

  test('empty actions array → 400 PERMISSION_GROUP_ACTIONS_EMPTY', async () => {
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {
      [`empty_actions_${SUFFIX}`]: [],
    });
    expect(res.status).toBe(400);
    expect(allCodes(res.data as ValidationFailure)).toContain('PERMISSION_GROUP_ACTIONS_EMPTY');
  });

  test('action with uppercase → 400 PERMISSION_GROUP_ACTION_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {
      [`upper_action_${SUFFIX}`]: ['Read'],
    });
    expect(res.status).toBe(400);
    expect(allCodes(res.data as ValidationFailure)).toContain('PERMISSION_GROUP_ACTION_PATTERN');
  });

  test('action starting with digit → 400 PERMISSION_GROUP_ACTION_PATTERN', async () => {
    const res = await api(adminSession, 'POST', '/api/permissions/groups', {
      [`digit_action_${SUFFIX}`]: ['1read'],
    });
    expect(res.status).toBe(400);
    expect(allCodes(res.data as ValidationFailure)).toContain('PERMISSION_GROUP_ACTION_PATTERN');
  });
});
