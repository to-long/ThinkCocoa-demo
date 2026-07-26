/**
 * Shared custom column types for ImpactCocoa.
 *
 * Drizzle doesn't ship built-in wrappers for PostGIS `geometry` or the
 * `citext` type, so we define them here and reuse across schemas.
 */

import { customType } from 'drizzle-orm/pg-core';

/** PostGIS geometry column. Defaults to `geometry` unless parameters given. */
export const geometry = customType<{
  data: string;
  driverData: string;
  config: { type: string; srid: number };
}>({
  dataType(config) {
    return config ? `geometry(${config.type}, ${config.srid})` : 'geometry';
  },
});

/** Case-insensitive text (pg citext extension). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});
