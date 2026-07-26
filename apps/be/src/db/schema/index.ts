/**
 * Barrel export for every drizzle schema.
 *
 * Consumers should import specific tables from here for type-safe queries:
 *
 *   import { farmers, inspections } from '@/db/schema';
 *
 * The drizzle-kit config points at this file; do not remove re-exports here
 * or drizzle-kit will stop tracking those tables.
 */

// `coaching.ts` and `training.ts` are NOT re-exported from this
// barrel — their table names (`trainingSessions`, `trainingAttendance`,
// `coachingVisits`) collide with legacy `field-ops.ts` definitions
// from migrations 004 / 013. Feature code imports them by direct
// path: `import { coachingVisits } from '../../db/schema/coaching'`
// (same convention `inspection.ts` follows).
export * from './audit';
export * from './farmer';
export * from './field-ops';
export * from './gis';
export * from './iam';
export * from './reference';
export * from './reporting';
export * from './traceability';
export * from './integration';
