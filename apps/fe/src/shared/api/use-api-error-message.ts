/**
 * Small helper that turns an `ApiError` into a user-facing message + a routing
 * side-effect on 401.
 *
 * 400 + validation → localized `validator.<CODE>` message (falls back to the
 * raw code if no translation exists).
 * 401             → navigates to `/login`.
 * 403             → "you don't have permission" inline banner text.
 * everything else → "Something went wrong".
 */

import { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { ApiError } from './fetcher';

const GENERIC_KEY = 'errors.generic';
const FORBIDDEN_KEY = 'errors.forbidden';

export function useApiErrorMessage() {
  const intl = useIntl();
  const navigate = useNavigate();

  return useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError)) {
        // Non-API error (network, TypeError). Return generic message.
        return safeFormat(intl, GENERIC_KEY, 'Something went wrong');
      }

      if (err.status === 401) {
        navigate('/login');
        return safeFormat(intl, 'errors.unauthenticated', 'Please sign in');
      }

      if (err.status === 403) {
        return safeFormat(intl, FORBIDDEN_KEY, "You don't have permission to do this");
      }

      if (err.status === 400 && err.validation) {
        const issue = err.firstIssue;
        if (issue) {
          return safeFormat(
            intl,
            `validator.${issue.code}`,
            // Fallback shows the code itself so devs see it during dev.
            issue.code,
            issue.params,
          );
        }
      }

      // Conflict (409) / server error (5xx) — prefer the body message if the
      // BE returned one, else the generic message.
      if (typeof err.body === 'object' && err.body && 'error' in err.body) {
        const txt = (err.body as { error?: unknown }).error;
        if (typeof txt === 'string' && txt.length > 0) return txt;
      }

      return safeFormat(intl, GENERIC_KEY, 'Something went wrong');
    },
    [intl, navigate],
  );
}

function safeFormat(
  intl: ReturnType<typeof useIntl>,
  id: string,
  fallback: string,
  params?: Record<string, string | number>,
) {
  try {
    const msg = intl.formatMessage({ id, defaultMessage: fallback }, params);
    return msg || fallback;
  } catch {
    return fallback;
  }
}
