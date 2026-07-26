/**
 * Opinionated Zustand store factory — ported from the TMG shared-ui package.
 *
 * - Wraps `zustand/devtools` so every store shows up in the Redux DevTools
 *   browser extension (handy for inspecting state + action log during dev).
 * - Optional `persistKeys` wraps the store in `zustand/persist` with a
 *   narrow `partialize` that saves only the listed keys to localStorage.
 * - Action names flow through the third argument of `setState(...)`; pass
 *   a short label (e.g. `'perms/set'`) so DevTools groups updates cleanly.
 */

import { create, type Mutate, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

type StoreWithDevtools<T> = UseBoundStore<Mutate<StoreApi<T>, [['zustand/devtools', never]]>>;

interface CreateStoreOptions<T> {
  /**
   * Keys to persist in localStorage via zustand/persist middleware.
   * Uses the store `name` as the storage key.
   * Only specified keys are saved; others remain in-memory only.
   */
  persistKeys?: (keyof T)[];
}

export function createStore<T extends object>(
  initializer: StateCreator<T, [['zustand/devtools', never]], []>,
  name = 'ZustandStore',
  options: CreateStoreOptions<T> = {},
): StoreWithDevtools<T> {
  const { persistKeys } = options;

  if (persistKeys && persistKeys.length > 0) {
    return create<T>()(
      devtools(
        // biome-ignore lint/suspicious/noExplicitAny: middleware stacking
        (persist as any)(initializer, {
          name,
          partialize: (state: T) => {
            const partial: Partial<T> = {};
            for (const key of persistKeys) {
              partial[key] = state[key];
            }
            return partial;
          },
        }),
        { name },
      ),
    ) as StoreWithDevtools<T>;
  }

  return create<T>()(devtools(initializer, { name }));
}
