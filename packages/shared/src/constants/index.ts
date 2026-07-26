export const APP_NAME = 'CocoaImpact';
export const APP_DESCRIPTION = 'Think!Cocoa Data Management Platform';

export const LOCALES = ['en', 'fr'] as const;
export const DEFAULT_LOCALE = 'en';

export const MIN_PASSWORD_LENGTH = 8;
export const SESSION_COOKIE_NAME = 'better-auth.session_token';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const INSPECTION_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export const SHIPMENT_STATUSES = ['pending', 'in_transit', 'delivered', 'cancelled'] as const;
export const EUDR_STATUSES = ['compliant', 'non_compliant', 'pending_review'] as const;

// Legacy placeholder — kept to avoid breaking any stray import. The
// canonical role codes live in the seed (`apps/be/db/seed/iam.ts`)
// under `ROLE_ROWS`; a future pass will move those here too.
export const ROLES = ['admin', 'manager', 'inspector', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

// IAM permissions — `resource:action` catalog + the `PermissionCode` union.
// Single source of truth consumed by BE seed, BE middleware, and FE gates.
export * from './permissions';

export const SRID = 4326;
export const DEFAULT_MAP_CENTER = { lat: 6.5, lng: -5.5 };
export const DEFAULT_MAP_ZOOM = 7;
