/**
 * Per-user "read inspections" tracking.
 *
 * v1 stores the set in localStorage keyed by the current user id, so
 * multiple accounts sharing a browser don't collide. The BE has no
 * corresponding column yet — moving to a proper `inspection_reads`
 * table is a future upgrade when read state needs to sync across
 * devices.
 *
 * Reactivity: `useSyncExternalStore` + a module-level listener set,
 * so `markRead` inside a detail page immediately re-renders any list
 * page hook that's mounted (e.g. the filter counter).
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

const KEY_PREFIX = 'inspections.read.';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function notify(): void {
  for (const l of listeners) l();
}

function readRaw(userId: string): string {
  try {
    return localStorage.getItem(storageKey(userId)) ?? '';
  } catch {
    return '';
  }
}

function parseSet(raw: string): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSet(userId: string, s: Set<string>): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...s]));
  } catch {
    // Storage disabled / quota — silently swallow; the UI still
    // reflects the toggle for the current render pass.
  }
  notify();
}

/** Reactive access to the read-inspection set for a user. */
export function useReadInspections(userId: string) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => readRaw(userId),
    () => '',
  );
  // Memo so `set` identity is stable across renders where snapshot
  // didn't change — satisfies useCallback([set]) below.
  const set = useMemo(() => parseSet(snapshot), [snapshot]);

  const isRead = useCallback(
    (inspectionId: string | number) => set.has(String(inspectionId)),
    [set],
  );
  const markRead = useCallback(
    (inspectionId: string | number) => {
      const cur = parseSet(readRaw(userId));
      const id = String(inspectionId);
      if (!cur.has(id)) {
        cur.add(id);
        writeSet(userId, cur);
      }
    },
    [userId],
  );
  const markUnread = useCallback(
    (inspectionId: string | number) => {
      const cur = parseSet(readRaw(userId));
      const id = String(inspectionId);
      if (cur.has(id)) {
        cur.delete(id);
        writeSet(userId, cur);
      }
    },
    [userId],
  );

  return { isRead, markRead, markUnread, readCount: set.size };
}
