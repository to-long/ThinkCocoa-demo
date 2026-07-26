/**
 * Users — row mapper + audit snapshot helper.
 *
 * Kept separate from `service.ts` so anything that wants to render a
 * users row (e.g. cooperative chair lookup, future export job) can
 * reuse the shape without dragging in route or query helpers.
 */

import type { users } from '../../db/schema/iam';

/** User-editable columns we audit on `iam.users`. Excludes
 *  password/hash columns (those live in iam.accounts) and noisy fields
 *  like `lastLoginAt` that change on every authed request. */
export function userAuditSnapshot(u: typeof users.$inferSelect) {
  return {
    email: u.email,
    name: u.name,
    image: u.image,
    status: u.status,
    defaultCooperativeId: u.defaultCooperativeId,
    isAllCooperative: u.isAllCooperative,
  };
}

export interface UserCoopAssignment {
  cooperativeId: string;
  cooperativeCode: string;
  cooperativeName: string;
  scope: 'district' | 'all_districts';
  isPrimary: boolean;
}

/** Reshape a users row for JSON response. Role codes + cooperative
 *  assignments must be passed in from the caller — list uses a bulk
 *  join, detail builds its own fetch. */
export function toUserResponse(
  u: typeof users.$inferSelect,
  roleCodes: string[] = [],
  cooperativeAssignments: UserCoopAssignment[] = [],
) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.name,
    image: u.image,
    emailVerified: u.emailVerified,
    status: u.status as 'active' | 'inactive' | 'locked',
    defaultCooperativeId: u.defaultCooperativeId,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    deletedAt: u.deletedAt?.toISOString() ?? null,
    isAllCooperative: u.isAllCooperative,
    roles: roleCodes,
    cooperativeAssignments,
  };
}
