/**
 * Permissions — row mapper shared between list/detail/create/update.
 *
 * `iam.permissions` is a plain table (no JSONB columns), so this file
 * is small — but kept separate so the response shape lives in one
 * place. List, detail, create, and update all serialise the same way.
 */

import type { permissions } from '../../db/schema/iam';

export type PermissionRow = typeof permissions.$inferSelect;

export interface PermissionResponse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export function toRowResponse(r: PermissionRow): PermissionResponse {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  };
}
