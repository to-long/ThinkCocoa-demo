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

// Display labels + sub-line per resource. Falls back to a
// title-cased prefix if a resource lands here without a config.
const RESOURCE_LABELS: Record<string, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Receive notifications surfaced on the system overview',
  },
  farmer: {
    title: 'Farmer',
    subtitle: 'Receive updates when farmer information is modified',
  },
  parcel: {
    title: 'Farm',
    subtitle: 'Get notified about farm activity and field changes',
  },
  vsla: {
    title: 'VSLA',
    subtitle: 'Get notified about savings-group cycles and activity',
  },
  training: {
    title: 'Training',
    subtitle: 'Stay informed about upcoming training sessions and materials',
  },
  coaching: {
    title: 'Coaching',
    subtitle: 'Stay informed about coaching visits and compliance scores',
  },
  purchase: {
    title: 'Purchase',
    subtitle: 'Track society-level cocoa purchase records',
  },
  primary_evac: {
    title: '1st Evac',
    subtitle: 'Track primary evacuation lots from society to warehouse',
  },
  secondary_evac: {
    title: '2nd Evac',
    subtitle: 'Track secondary evacuation lots and DDS status',
  },
  inspection: {
    title: 'Inspection',
    subtitle: 'Receive alerts for scheduled and completed field inspections',
  },
  cooperative: {
    title: 'Cooperative',
    subtitle: 'Get notified about cooperative profile and member changes',
  },
  user: {
    title: 'User',
    subtitle: 'Receive alerts for user account changes',
  },
  role: {
    title: 'Role',
    subtitle: 'Get notified when role definitions or grants change',
  },
  permission: {
    title: 'Permission',
    subtitle: 'Track changes to the permission catalog',
  },
};

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
            const config = RESOURCE_LABELS[resource] ?? {
              title: resource.charAt(0).toUpperCase() + resource.slice(1),
              subtitle: `Receive notifications for ${resource} events`,
            };
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
                    <span className="truncate">{config.title}</span>
                  </StatusTag>
                  <span className="text-[12px] text-muted-foreground">{config.subtitle}</span>
                </div>
                {isPending ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={isOn}
                    onCheckedChange={(next) => onToggle(resource, next)}
                    aria-label={config.title}
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
