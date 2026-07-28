/**
 * Breadcrumb plumbing.
 *
 * A tiny zustand store + effect hook pair. Any page calls
 * `useBreadcrumb([{ label, href }, ...])` on mount; the top-bar renders
 * the trail via `<Breadcrumbs>`. Unmounting a page clears the trail so
 * stale segments don't leak into the next route.
 *
 * Pages should set breadcrumb in the domain order — e.g.
 *   useBreadcrumb([
 *     { label: 'IAM' },
 *     { label: 'Users', href: '/users' },
 *     { label: user.fullName }, // current page — no href
 *   ]);
 */

import { useEffect } from 'react';
import { createStore } from '@/lib/zustand/createStore';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbState {
  items: BreadcrumbItem[];
}

const initialState: BreadcrumbState = { items: [] };

const ACTIONS = {
  set: 'breadcrumb/set',
  clear: 'breadcrumb/clear',
} as const;

export const useBreadcrumbStore = createStore<BreadcrumbState>(
  () => initialState,
  'BreadcrumbStore',
);

export const selectBreadcrumbItems = (s: BreadcrumbState): BreadcrumbItem[] => s.items;

/**
 * Set the breadcrumb for the current page. Auto-clears on unmount.
 *
 * A fresh array literal on every render is fine — we stringify for
 * equality so the effect only re-runs when the payload actually changes.
 */
export function useBreadcrumb(items: BreadcrumbItem[]): void {
  // The serialized payload IS the dependency. It was computed but never
  // used, leaving `[items]` — a fresh array literal every render, per the
  // note above — so the effect set the breadcrumb and its cleanup cleared
  // it again on every single render.
  const serialized = JSON.stringify(items);
  useEffect(() => {
    useBreadcrumbStore.setState({ items: JSON.parse(serialized) }, false, ACTIONS.set);
    return () => {
      useBreadcrumbStore.setState(initialState, false, ACTIONS.clear);
    };
  }, [serialized]);
}
