/**
 * Debounced URL-synced search input used across every list page.
 *
 * Behaviour contract (identical everywhere it's mounted):
 *   - Typing updates local state instantly for a snappy caret.
 *   - After `debounceMs` of quiet, the value is pushed up via
 *     `onValueChange(next)`. Caller is expected to reflect it into
 *     the URL query string.
 *   - External changes to `value` (browser back, sidebar link with
 *     `?q=...`, `resetFilters`) flow back into the input.
 *   - The X clear button flushes immediately (no debounce wait).
 *   - Enter is intentionally NOT special — the debounce already
 *     fires within half a second, so there's nothing to "commit".
 *
 * Why not just useDebounce inline on every page:
 *   - Half the list pages debounce, half wait for onBlur/Enter, and
 *     one had a two-effect loop that clobbered the caret when the
 *     debounce settled ("aka" would visually reset to "a" mid-type).
 *   - Consolidating here gives every list page the same feel and
 *     the same edge-case guards (lastPushedRef prevents self-echo).
 */

import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { Input } from '@/components/ui/input';

interface Props {
  /** URL-authoritative search string. Empty string when clear. */
  value: string;
  /** Fires after `debounceMs` of no typing, and immediately on clear.
   *  Caller pushes it into the URL / SWR key. */
  onValueChange: (next: string) => void;
  placeholder: string;
  /** Debounce window. 500ms is snappy but avoids firing on every
   *  keystroke of a moderate typist. */
  debounceMs?: number;
  /** Extra classes for the outer wrapper (mostly for grid sizing). */
  className?: string;
}

export function ListSearch({
  value,
  onValueChange,
  placeholder,
  debounceMs = 500,
  className,
}: Props) {
  const [local, setLocal] = useState(value);
  const [debounced] = useDebounce(local, debounceMs);
  // Remembers what we most recently pushed to the parent, so the
  // "external URL changed" effect below doesn't fire in response to
  // our own push (which would clobber the caret with a stale value).
  const lastPushedRef = useRef(value);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onValueChange is the escape hatch; we only push on debounce change
  useEffect(() => {
    // Trim before pushing so a stray leading/trailing space never
    // reaches the query (`"a "` searches as `"a"`). `local` (the visible
    // input) is left untouched so multi-word typing still works.
    const next = debounced.trim();
    if (next !== value) {
      lastPushedRef.current = next;
      onValueChange(next);
    }
  }, [debounced, value]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to external URL changes
  useEffect(() => {
    if (value === lastPushedRef.current) return;
    if (value !== local) setLocal(value);
  }, [value]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <SearchIcon
        aria-hidden
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
      />
      <Input
        className="pl-9"
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onClear={() => {
          setLocal('');
          lastPushedRef.current = '';
          onValueChange('');
        }}
      />
    </div>
  );
}
