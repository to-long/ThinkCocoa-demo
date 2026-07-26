/**
 * API endpoint validation tests for `/api/farmers`. Uses the seeded
 * SANKOFA cooperative (the IMS manager has scope on it) so the
 * `cooperative:create` middleware lets the request through to
 * `validationHook`.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { cooperatives } from '../db/schema/iam';
import { type AuthSession, api, signInAs, TEST_USERS, uniqueSuffix } from './helpers';

let imsSession: AuthSession;
let cooperativeId: string;
const SUFFIX = uniqueSuffix();

beforeAll(async () => {
  imsSession = await signInAs(TEST_USERS.imsManager.email, TEST_USERS.imsManager.password);
  // ims.manager.sankofa is scoped to the SANKOFA coop — fetch
  // its UUID so the create payloads pass the requireActiveCoop gate.
  const [row] = await db
    .select({ id: cooperatives.id })
    .from(cooperatives)
    .where(eq(cooperatives.code, 'SANKOFA'));
  if (!row) throw new Error('SANKOFA cooperative not seeded — fix seed.');
  cooperativeId = row.id;
});

interface ValidationFailure {
  error: string;
  issues: Array<{ path: string; code: string }>;
}

const codesAt = (body: ValidationFailure, path: string) =>
  body.issues.filter((i) => i.path === path).map((i) => i.code);

const VALID_CREATE = () => ({
  cooperativeId,
  farmerCode: `E2E-${SUFFIX.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
  firstName: 'Validation',
  lastName: 'Probe',
});

describe('POST /api/farmers — validation', () => {
  test('happy path returns 201', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', VALID_CREATE());
    expect(res.status).toBe(201);
  });

  test('empty farmerCode → 400 FARMER_CODE_REQUIRED', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      farmerCode: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'farmerCode')).toContain('FARMER_CODE_REQUIRED');
  });

  test('farmerCode with spaces → 400 FARMER_CODE_PATTERN', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      farmerCode: 'F 001!',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'farmerCode')).toContain('FARMER_CODE_PATTERN');
  });

  test('empty firstName → 400 FIRST_NAME_REQUIRED', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      firstName: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'firstName')).toContain('FIRST_NAME_REQUIRED');
  });

  test('firstName with digits is allowed (e.g. "Kofi 2")', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      firstName: 'Kofi 2',
    });
    expect(res.status).toBe(201);
  });

  test('firstName with disallowed punctuation → 400 PERSON_NAME_INVALID', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      firstName: 'John@Doe',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'firstName')).toContain('PERSON_NAME_INVALID');
  });

  test('phone with letters → 400 PHONE_INVALID', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      phoneNumber: 'call me',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'phoneNumber')).toContain('PHONE_INVALID');
  });

  test('cooperativeId not uuid → 400 UUID_INVALID', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      cooperativeId: 'not-a-uuid',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'cooperativeId')).toContain('UUID_INVALID');
  });

  test('householdSize > 100 → 400 NUMBER_TOO_LARGE', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      householdSize: 999,
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'householdSize')).toContain('NUMBER_TOO_LARGE');
  });

  test('householdSize negative → 400 INTEGER_NON_NEGATIVE', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      householdSize: -1,
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'householdSize')).toContain(
      'INTEGER_NON_NEGATIVE',
    );
  });

  test('dateOfBirth pre-1900 → 400 DATE_OUT_OF_RANGE', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      dateOfBirth: '1850-06-15',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'dateOfBirth')).toContain('DATE_OUT_OF_RANGE');
  });

  test('society > 200 chars → 400 TEXT_TOO_LONG', async () => {
    const res = await api(imsSession, 'POST', '/api/farmers', {
      ...VALID_CREATE(),
      society: 'a'.repeat(300),
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'society')).toContain('TEXT_TOO_LONG');
  });
});

describe('PATCH /api/farmers/:id — validation', () => {
  let farmerId: string;

  beforeAll(async () => {
    const res = await api<{ id: string }>(imsSession, 'POST', '/api/farmers', VALID_CREATE());
    expect(res.status).toBe(201);
    farmerId = res.data!.id;
  });

  test('empty firstName (when provided) → 400 FIRST_NAME_REQUIRED', async () => {
    const res = await api(imsSession, 'PATCH', `/api/farmers/${farmerId}`, {
      firstName: '',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'firstName')).toContain('FIRST_NAME_REQUIRED');
  });

  test('phone bad (when provided) → 400 PHONE_INVALID', async () => {
    const res = await api(imsSession, 'PATCH', `/api/farmers/${farmerId}`, {
      phoneNumber: 'call',
    });
    expect(res.status).toBe(400);
    expect(codesAt(res.data as ValidationFailure, 'phoneNumber')).toContain('PHONE_INVALID');
  });

  test('valid partial patch returns 200', async () => {
    const res = await api(imsSession, 'PATCH', `/api/farmers/${farmerId}`, {
      firstName: 'Renamed',
    });
    expect(res.status).toBe(200);
  });
});
