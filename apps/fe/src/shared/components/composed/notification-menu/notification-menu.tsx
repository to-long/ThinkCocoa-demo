/**
 * Header notification dropdown. Matches Pencil `swDwH`. Layout:
 *
 *   ┌─────────────────────────────────────┐
 *   │ Notifications        ⚙ Settings     │  ← header (justify-between)
 *   ├─────────────────────────────────────┤
 *   │ [AA] Actor A     · 30 min ago       │  ← unread (accent bg)
 *   │      update Farmer 001              │
 *   │ [AB] Actor B     · 8 hours ago      │
 *   │      create Farmer 002              │
 *   ├─────────────────────────────────────┤
 *   │       View all notifications        │  ← primary tone
 *   └─────────────────────────────────────┘
 *
 * Data source today: `/api/audit-logs` paginated to the latest 5 rows.
 * When the dedicated `/api/notifications` endpoint ships (per
 * `docs/notifications-and-audit-refactor-plan.md`), swap the SWR hook
 * + plug a real `last_read_audit_id` cursor into the unread flag.
 */

import { getApiAuditLogs } from '@cocoaimpact/shared/impact-cocoa-client';
import { Bell, Loader2, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWRInfinite from 'swr/infinite';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import type { ApiAuditLog, AuditLogListResponse } from '@/shared/api/audit-logs';
import { unwrap } from '@/shared/api/fetcher';
import {
  markNotificationsRead,
  useNotificationStream,
  useUnreadNotificationCount,
} from '@/shared/api/notifications';
import { selectActiveCoopId, useActiveCoop } from '@/shared/store/useActiveCoop';
import { NotificationMenuItem } from './notification-menu-item';

// Audit `entity_table` → human-readable resource label rendered
// inside the gray pill on each row. Falls back to a Title-cased
// version of the table name for tables not in the map.
const ENTITY_LABELS: Record<string, string> = {
  farmers: 'Farmer',
  parcels: 'Farm',
  inspections: 'Inspection',
  trainings: 'Training',
  batches: 'Batch',
  eudr_assessments: 'EUDR',
  cooperatives: 'Cooperative',
  users: 'User',
  roles: 'Role',
  permissions: 'Permission',
  sync_jobs: 'Sync',
  report_runs: 'Report',
  audit_logs: 'Audit',
};

function resourceLabel(entityTable: string): string {
  return ENTITY_LABELS[entityTable] ?? entityTable.charAt(0).toUpperCase() + entityTable.slice(1);
}

// Build the row's event line rendered under the actor name. Two
// shapes:
//   1. With a `metadata.entity` snapshot → "update Farmer Mensah John"
//   2. Without snapshot → the BE-built `summary` verbatim (already
//      contains a verb like "Updated permission group X")
// Mixing the two shapes (e.g. "update Permission Updated permission
// group X") double-stamps the verb; falling back to `summary` alone
// avoids that.
function eventText(row: ApiAuditLog): string {
  const entity = (row.metadata?.entity ?? null) as Record<string, unknown> | null;
  if (entity) {
    let label: string | null = null;
    if (row.entityTable === 'farmers' && entity.firstName && entity.lastName) {
      label = `${entity.firstName} ${entity.lastName}`;
    } else if (row.entityTable === 'parcels' && entity.parcelCode) {
      label = String(entity.parcelCode);
    } else if (row.entityTable === 'batches' && entity.purchaseCode) {
      label = String(entity.purchaseCode);
    } else {
      for (const v of Object.values(entity)) {
        if (typeof v === 'string' && v.length > 0) {
          label = v;
          break;
        }
      }
    }
    if (label) {
      return `${row.action.toLowerCase()} ${resourceLabel(row.entityTable)} ${label}`;
    }
  }
  return row.summary ?? row.entityId ?? '—';
}

// The read cursor lives in `iam.user_notification_reads` (BE-owned) —
// see `markNotificationsRead`. The old localStorage shim is gone, so the
// badge no longer resurrects itself on a new browser or device.

// "30 min ago", "8 hours ago", "2 days ago", "2024-01-14 13:55".
// Matches the timestamp variants shown in the Pencil design.
function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  // Older — render an absolute timestamp; matches the bottom row in
  // the Pencil design ("2024-01-14 13:55").
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

const PAGE_SIZE = 5;

export function NotificationMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Active-coop scope — pass into the audit list so notifications
  // never leak from a cooperative the user just switched away from.
  // Switching coop changes the SWR key, so SWR drops the old result
  // and shows the loading state until the new coop's rows arrive.
  const activeCoopId = useActiveCoop(selectActiveCoopId);

  // Infinite-load latest audit rows (5 per page). The dropdown
  // shows page 1 immediately and grows as the user scrolls to the
  // bottom of the list. When the active coop changes, SWR drops
  // every page (key changes) and refetches page 1.
  const getKey = (
    pageIndex: number,
    previous: AuditLogListResponse | null,
  ): readonly [string, Record<string, string | number>] | null => {
    if (previous && previous.data.length < PAGE_SIZE) return null;
    const params: Record<string, string | number> = {
      page: pageIndex + 1,
      pageSize: PAGE_SIZE,
    };
    if (activeCoopId) params.cooperativeId = activeCoopId;
    return ['/api/audit-logs/infinite', params] as const;
  };
  const {
    data: pages,
    setSize,
    isValidating,
    mutate: mutatePages,
  } = useSWRInfinite<AuditLogListResponse>(
    getKey,
    async (key) => {
      // SWR types the key generically; we know it's our tuple.
      const [, params] = key as readonly [string, Record<string, string | number>];
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) query[k] = String(v);
      const res = await getApiAuditLogs({ query });
      return unwrap(res) as AuditLogListResponse;
    },
    {
      revalidateOnFocus: false,
      // MUST stay true: new notifications prepend to page 0, so the
      // SSE-driven `mutatePages()` has to refetch the first page or the
      // list stays stale (count bumps, list doesn't) until the next
      // trigger. `false` was the bug behind that ~30s staleness.
      revalidateFirstPage: true,
      // 60s dedup so clicking the bell repeatedly doesn't hammer the
      // BE. SSE events (see `useNotificationStream` below) still force a
      // revalidate the moment a real notification arrives — explicit
      // `mutate` bypasses the dedup window — so freshness is kept.
      dedupingInterval: 60_000,
    },
  );

  const items: ApiAuditLog[] = pages ? pages.flatMap((p) => p.data) : [];
  const lastPage = pages?.[pages.length - 1];
  const reachedEnd = !!lastPage && lastPage.data.length < PAGE_SIZE;

  // Bell badge count — backed by `/api/notifications/unread-count`.
  // The SSE stream below bumps this number live; opening the bell
  // resets it (we treat list-open as "user saw them").
  // No client cursor — the BE reads the caller's row in
  // `iam.user_notification_reads`, so the badge is account-scoped.
  const { data: unread, mutate: mutateUnread } = useUnreadNotificationCount();
  // SSE event arrives → invalidate the bell list cache via the LOCAL
  // `mutatePages`. We can't reach `useSWRInfinite`'s cache through
  // the global `mutate(predicate)` because it stores keys under a
  // wrapped `$inf$…` string, not the raw tuple.
  useNotificationStream(null, mutatePages);
  const unreadCount = unread?.count ?? 0;

  // Open / close handler. Freshness comes from two sources now —
  // SSE-driven invalidation (any new audit row → `mutatePages()`
  // automatically in `useNotificationStream`) and the 60 s SWR dedup
  // window. Clicking the bell no longer forces a re-fetch: if the
  // cache is hot (data <60 s old) it shows instantly with zero
  // network. We only collapse the list back to page 1 visually so
  // the dropdown opens at a bounded height.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setSize(1);
    } else if (open) {
      // Bell just closed — persist the cursor server-side. Target is the
      // highest id the BE reports visible, NOT the max of the loaded page:
      // the list sorts by `created_at` while the cursor compares ids, and
      // those orders differ, so a newer id can sit on a later page and the
      // badge would never clear.
      const target = Math.max(
        unread?.latestId ?? 0,
        items.length > 0 ? Math.max(...items.map((r) => r.id)) : 0,
      );
      if (target > 0) {
        markNotificationsRead(target)
          .then(() => mutateUnread())
          .catch(() => {
            // Non-fatal: the badge just stays until the next poll.
          });
      }
    }
  };

  // Infinite scroll — IntersectionObserver on a sentinel at the
  // end of the list. Fires `setSize(size + 1)` when the sentinel
  // enters the viewport AND we haven't hit the last page yet.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !reachedEnd && !isValidating) {
          setSize((s) => s + 1);
        }
      },
      { root: el.parentElement, rootMargin: '60px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [open, reachedEnd, isValidating, setSize]);

  const handleViewAll = () => {
    setOpen(false);
    navigate('/notifications');
  };

  const handleOpenSettings = () => {
    setOpen(false);
    navigate('/profile#notification');
  };

  const handleOpenDetail = (auditLogId: number) => {
    setOpen(false);
    navigate(`/notifications/${auditLogId}`);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="relative flex size-8 items-center justify-center rounded-md bg-accent text-foreground transition-colors hover:bg-sidebar-accent">
        <Bell className="size-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-[300px] p-1"
        showArrow
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-[13px] font-semibold text-foreground">Notifications</span>
          <button
            type="button"
            onClick={handleOpenSettings}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="size-3" />
            Settings
          </button>
        </div>
        <Separator className="my-1" />
        {/* Items — first page (5 rows) renders inline; further
            pages stream in as the user scrolls past the sentinel
            below. Container is height-capped + scrollable so the
            popover stays bounded. */}
        <div className="flex max-h-[320px] flex-col overflow-y-auto">
          {items.length === 0 && !isValidating ? (
            <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <>
              {items.map((row) => (
                <NotificationMenuItem
                  key={row.id}
                  actorName={row.actorFullName ?? row.actorEmail ?? 'System'}
                  text={eventText(row)}
                  time={relativeTime(row.createdAt)}
                  onClick={() => handleOpenDetail(row.id)}
                />
              ))}
              {/* Sentinel: visible → load next page. Always
                  rendered so the IntersectionObserver fires on
                  initial mount when the list is short. */}
              {!reachedEnd && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center px-3 py-2 text-[11px] text-muted-foreground"
                >
                  {isValidating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <span className="opacity-0">·</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <Separator className="my-1" />
        {/* Footer */}
        <button
          type="button"
          onClick={handleViewAll}
          className="w-full rounded p-1 text-center text-[12px] font-medium text-primary hover:underline"
        >
          View all notifications
        </button>
      </PopoverContent>
    </Popover>
  );
}
