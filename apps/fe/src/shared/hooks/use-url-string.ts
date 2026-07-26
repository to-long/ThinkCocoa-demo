/**
 * Mirror a single string-valued search-param into the URL.
 *
 * Same conventions as `usePageParam`:
 *   - Missing or matching-default values → param is REMOVED from the
 *     URL, so the canonical "no filter" URL stays clean.
 *   - Other params are preserved when this one updates.
 *   - `replace: true` keeps every keystroke from spamming history.
 *
 * Pass `defaultValue` to avoid leaking the default into the URL: if
 * the next value matches it, the param is dropped.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlString<T extends string>(
  paramName: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = (searchParams.get(paramName) ?? defaultValue) as T;

  const setValue = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (!next || next === defaultValue) out.delete(paramName);
          else out.set(paramName, next);
          return out;
        },
        { replace: true },
      );
    },
    [paramName, defaultValue, setSearchParams],
  );

  return [value, setValue];
}

/** Like `useUrlString` but typed for an integer. Falls back to
 *  `defaultValue` for missing / invalid / out-of-range values. */
export function useUrlNumber(
  paramName: string,
  defaultValue: number,
  options: { min?: number; max?: number } = {},
): [number, (next: number) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(paramName);
  const parsed = raw === null ? NaN : Number(raw);
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  const value =
    Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : defaultValue;

  const setValue = useCallback(
    (next: number) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (!Number.isFinite(next) || next === defaultValue) {
            out.delete(paramName);
          } else {
            out.set(paramName, String(next));
          }
          return out;
        },
        { replace: true },
      );
    },
    [paramName, defaultValue, setSearchParams],
  );

  return [value, setValue];
}
