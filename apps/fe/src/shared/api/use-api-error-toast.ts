/**
 * Thin wrapper around `useApiErrorMessage` that fires a sonner toast
 * instead of (or in addition to) populating an inline banner.
 *
 * Use in mutation `catch` blocks — toasts are the right surface for
 * transient action failures (Save click, Delete click) because they
 * appear right next to the user's focus, auto-dismiss, and don't shift
 * page layout. Persistent failures (list-load errors that block the
 * whole page) should still use `<ErrorBanner>`.
 *
 * Example:
 *   const errorToast = useApiErrorToast();
 *   try { await createUser(payload); }
 *   catch (err) { errorToast(err); throw err; }
 *
 * The hook deliberately swallows the toast call: callers should still
 * `throw` the error (or otherwise handle it) — this only covers
 * notification, not error-flow control.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useApiErrorMessage } from './use-api-error-message';

export function useApiErrorToast() {
  const getErrorMessage = useApiErrorMessage();
  return useCallback(
    (err: unknown, fallback?: string) => {
      const msg = getErrorMessage(err) || fallback || 'Something went wrong';
      toast.error(msg);
    },
    [getErrorMessage],
  );
}
