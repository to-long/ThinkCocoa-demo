/**
 * API endpoint validation tests for `/api/users`.
 *
 * Hits the live route through `app.fetch` (no schema introspection)
 * and asserts the response shape + issue codes admins / the FE rely
 * on. If a route ever swaps validators or stops emitting the shared
 * `code` strings, this suite catches it.
 *
 * Why this and not a schema-parity test: the route, the
 * `validationHook` middleware, the OpenAPI body wrapper, and the
 * shared zod schema all have to line up for the FE to render the
 * right inline message. Testing the full HTTP round-trip is the only
 * thing that confirms all four still agree.
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
  email: `validation.${SUFFIX}@example.test`,
  password: 'KuanaData2026!',
  name: 'Validation Probe',
  cooperativeIds: [],
  isAllCooperative: true,
});

describe('POST /api/users — validation', () => {
  test('happy path returns 201', async () => {
    const res = await api(adminSession, 'POST', '/api/users', VALID_CREATE());
    expect(res.status).toBe(201);
  });

  test('name > 200 chars → 400 TEXT_TOO_LONG on name (the bug from the report)', async () => {
    const res = await api(adminSession, 'POST', '/api/users', {
      ...VALID_CREATE(),
      email: `tl.${SUFFIX}.${Date.now()}@example.test`,
      name: 'a'.repeat(201),
    });
    expect(res.status).toBe(400);
    const body = res.data as ValidationFailure;
    expect(body.error).toBe('validation_failed');
    expect(codesAt(body, 'name')).toContain('TEXT_TOO_LONG');
  });

  test('empty name → 400 NAME_REQUIRED', async () => {
    const res = await api(adminSession, 'POST', '/api/users', {
      ...VALID_CREATE(),
      email: `empty.${SUFFIX}.${Date.now()}@example.test`,
      name: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'name')).toContain('NAME_REQUIRED');
  });

  test('email > 254 chars → 400 EMAIL_TOO_LONG', async () => {
    const longEmail = `${'a'.repeat(255)}@x.co`;
    const res = await api(adminSession, 'POST', '/api/users', {
      ...VALID_CREATE(),
      email: longEmail,
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'email')).toContain('EMAIL_TOO_LONG');
  });

  test('non-ASCII email (homoglyph) → 400 EMAIL_NON_ASCII', async () => {
    const res = await api(adminSession, 'POST', '/api/users', {
      ...VALID_CREATE(),
      email: 'аdmin@example.test', // Cyrillic а
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'email')).toContain('EMAIL_NON_ASCII');
  });

  test('short password → 400 PASSWORD_MIN_LENGTH', async () => {
    const res = await api(adminSession, 'POST', '/api/users', {
      ...VALID_CREATE(),
      email: `pw.${SUFFIX}.${Date.now()}@example.test`,
      password: 'abc',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'password')).toContain('PASSWORD_MIN_LENGTH');
  });
});

describe('PATCH /api/users/:id — validation', () => {
  let createdUserId: string;

  beforeAll(async () => {
    const created = await api<{ id: string }>(adminSession, 'POST', '/api/users', {
      ...VALID_CREATE(),
      email: `patchprobe.${SUFFIX}.${Date.now()}@example.test`,
    });
    expect(created.status).toBe(201);
    createdUserId = created.data!.id;
  });

  test('fullName > 200 chars → 400 TEXT_TOO_LONG on fullName', async () => {
    const res = await api(adminSession, 'PATCH', `/api/users/${createdUserId}`, {
      fullName: 'a'.repeat(201),
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'fullName')).toContain('TEXT_TOO_LONG');
  });

  test('empty fullName → 400 FULL_NAME_REQUIRED', async () => {
    const res = await api(adminSession, 'PATCH', `/api/users/${createdUserId}`, { fullName: '' });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'fullName')).toContain('FULL_NAME_REQUIRED');
  });

  test('image with bad URL → 400 URL_INVALID', async () => {
    const res = await api(adminSession, 'PATCH', `/api/users/${createdUserId}`, {
      image: 'not-a-url',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'image')).toContain('URL_INVALID');
  });

  test('valid patch returns 200', async () => {
    const res = await api(adminSession, 'PATCH', `/api/users/${createdUserId}`, {
      fullName: 'Patched Name',
    });
    expect(res.status).toBe(200);
  });
});
