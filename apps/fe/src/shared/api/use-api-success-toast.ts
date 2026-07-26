/**
 * Thin sonner wrapper for SUCCESS notifications, mirroring
 * `useApiErrorToast` so every mutation handler has a one-liner for
 * "save / delete / restore worked".
 *
 * Usage:
 *   const successToast = useApiSuccessToast();
 *
 *   // Plain message:
 *   successToast({ message: "Saved" });
 *
 *   // Intl key with interpolation:
 *   successToast({
 *     id: "farmers.toast.updated",
 *     values: { name: "John Doe" },
 *   });
 *
 *   // Both — intl with a fallback string when the key isn't loaded:
 *   successToast({
 *     id: "users.toast.created",
 *     values: { email: "x@y.com" },
 *     fallback: "User x@y.com is created",
 *   });
 *
 * Falls back to a generic "Saved" if the inputs resolve to nothing so
 * we never render an empty toast.
 */

import { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { toast } from 'sonner';

export interface SuccessToastOptions {
  /** react-intl message id. Resolved via `intl.formatMessage`. */
  id?: string;
  /** Placeholder values passed to `intl.formatMessage`. */
  values?: Record<string, string | number | null | undefined>;
  /** Used when no `id` is provided OR the id resolves to itself
   *  (key missing in the locale dictionary). */
  fallback?: string;
  /** Direct message — overrides everything else when set. */
  message?: string;
}

export function useApiSuccessToast() {
  const intl = useIntl();
  return useCallback(
    (opts: SuccessToastOptions = {}) => {
      let msg: string;
      if (opts.message) {
        msg = opts.message;
      } else if (opts.id) {
        // `intl.formatMessage` returns the id itself if no translation
        // exists. Treat that as "missing translation" and fall through
        // to the fallback so we don't render the raw key.
        const cleanValues = Object.fromEntries(
          Object.entries(opts.values ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
        );
        const resolved = intl.formatMessage(
          { id: opts.id, defaultMessage: opts.fallback ?? opts.id },
          cleanValues,
        );
        msg = resolved === opts.id ? (opts.fallback ?? 'Saved') : resolved;
      } else if (opts.fallback) {
        msg = opts.fallback;
      } else {
        msg = intl.formatMessage({
          id: 'common.toast.saved',
          defaultMessage: 'Saved',
        });
      }
      toast.success(msg);
    },
    [intl],
  );
}
