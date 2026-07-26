/**
 * Localised display name + description for a role code.
 *
 * Canonical role codes seeded by the BE (`field_officer`,
 * `system_admin`, …) have intl entries under
 * `roles.canonical.{code}.{name|description}`. Any other code (a
 * custom role created via the admin UI) falls back to the raw value
 * passed in, so the BE-stored display name still surfaces.
 *
 * Centralised here so the role list, user list filter, role badge
 * column, picker dialog, and coop-detail member section all read
 * the same source — flipping the locale immediately updates every
 * surface.
 */

import { useIntl } from 'react-intl';

const CANONICAL_ROLE_CODES = new Set([
  'field_officer',
  'ims_manager',
  'project_leader',
  'system_admin',
  'buyer',
  'cooperative_chair',
]);

function isCanonical(code: string): boolean {
  return CANONICAL_ROLE_CODES.has(code);
}

/** Translate a role code to its display name. Falls back to
 *  `defaultName` (typically the BE-stored `role.name`) for non-
 *  canonical codes. Pass the code itself as fallback when no other
 *  string is available. */
export function useRoleLabel() {
  const intl = useIntl();
  return (code: string, defaultName?: string): string => {
    if (isCanonical(code)) {
      return intl.formatMessage({
        id: `roles.canonical.${code}.name`,
        defaultMessage: defaultName ?? code,
      });
    }
    return defaultName ?? code;
  };
}

export function useRoleDescription() {
  const intl = useIntl();
  return (code: string, defaultDesc?: string | null): string => {
    if (isCanonical(code)) {
      return intl.formatMessage({
        id: `roles.canonical.${code}.description`,
        defaultMessage: defaultDesc ?? '',
      });
    }
    return defaultDesc ?? '';
  };
}
