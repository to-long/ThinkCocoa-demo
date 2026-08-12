/**
 * Notification preferences card on /profile (Pencil `N4rho`,
 * Notifications section). One toggle row per resource the user is
 * GRANTED via their role's `<resource>:notification` perms; flipping
 * a toggle calls PUT /api/notifications/preferences with the full
 * enabled list. Disabling silences both the bell badge AND the live
 * SSE stream — server fires `pg_notify('perm_changed')` so any open
 * connection drops + reconnects with the new filter.
 *
 * No client-side debounce: each toggle = one PUT. Optimistic update
 * keeps the UI snappy; SWR revalidates from the server response.
 */

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useSWRConfig } from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusTag } from '@/components/ui/status-tag';
import { Switch } from '@/components/ui/switch';
import { resourceIcon } from '@/features/admin/lib/permission-icons';
import { useApiErrorToast } from '@/shared/api';
import {
  notificationPreferencesKey,
  updateNotificationPreferences,
  useNotificationPreferences,
} from '@/shared/api/notifications';

// Plural entity_table → singular resource prefix is the BE
// convention; permission codes are singular. Order mirrors the
// sidebar (`menu-settings.ts`) section by section — Main → Operations
// → Compliance → Reporting → Administration — so the user finds
// each resource in the same place they navigate to it.
const RESOURCE_ORDER = [
  'dashboard',
  'farmer',
  'parcel',
  'vsla',
  'training',
  'coaching',
  'purchase',
  'primary_evac',
  'secondary_evac',
  'inspection',
  'cooperative',
  'user',
  'role',
  'permission',
] as const;

export function NotificationPreferencesForm() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { mutate } = useSWRConfig();
  const errorToast = useApiErrorToast();
  const { data, isLoading } = useNotificationPreferences();
  // Tracks the resource currently being PUT so its row can render
  // a spinner (and other rows stay interactive).
  const [pending, setPending] = useState<string | null>(null);

  const granted = data?.granted ?? [];
  const enabled = new Set(data?.enabled ?? []);
  // Render in canonical order; resources granted but not in
  // `RESOURCE_ORDER` (future additions) trail at the end.
  const sorted = [
    ...RESOURCE_ORDER.filter((r) => granted.includes(r)),
    ...granted.filter((r) => !RESOURCE_ORDER.includes(r as never)).sort(),
  ];

  const onToggle = async (resource: string, next: boolean) => {
    if (!data) return;
    const newEnabled = next
      ? [...data.enabled, resource]
      : data.enabled.filter((r) => r !== resource);
    setPending(resource);
    // Optimistic — flip immediately; SWR revalidates from server.
    mutate(notificationPreferencesKey(), { ...data, enabled: newEnabled }, false);
    try {
      const fresh = await updateNotificationPreferences(newEnabled);
      mutate(notificationPreferencesKey(), fresh, false);
    } catch (err) {
      // Roll back optimistic update.
      mutate(notificationPreferencesKey(), data, false);
      errorToast(err, 'Failed to update notification preferences');
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{t('profile.notifications.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground sm:col-span-2">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground sm:col-span-2">
            {t('profile.notifications.empty')}
          </p>
        ) : (
          sorted.map((resource) => {
            const Icon = resourceIcon(resource);
            // Label + sub-line per resource from i18n; a resource without a
            // dedicated key (future additions) falls back to a title-cased
            // prefix + generic line via `defaultMessage`.
            const title = intl.formatMessage({
              id: `profile.notif.${resource}.title`,
              defaultMessage: resource.charAt(0).toUpperCase() + resource.slice(1),
            });
            const subtitle = intl.formatMessage({
              id: `profile.notif.${resource}.subtitle`,
              defaultMessage: `Receive notifications for ${resource} events`,
            });
            const isOn = enabled.has(resource);
            const isPending = pending === resource;
            return (
              <div
                key={resource}
                className="flex items-center gap-3 border-border/40 border-b py-2.5"
              >
                {/* Icon + title rendered as a lime tag — matches the
                    permission-group headers in the role/user editors. */}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <StatusTag tone="lime" className="min-w-0">
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">{title}</span>
                  </StatusTag>
                  <span className="text-[12px] text-muted-foreground">{subtitle}</span>
                </div>
                {isPending ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={isOn}
                    onCheckedChange={(next) => onToggle(resource, next)}
                    aria-label={title}
                  />
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
