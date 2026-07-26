import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Breadcrumbs } from '@/shared/components/composed/breadcrumbs';
import { CoopSwitcher } from '@/shared/components/composed/coop-switcher';
import { DemoBanner } from '@/shared/components/composed/demo-banner';
import { NotificationMenu } from '@/shared/components/composed/notification-menu';
import { UserMenu } from '@/shared/components/composed/user-menu';
import type { Locale } from '@/shared/hooks/use-locale';

interface AppHeaderProps {
  actions?: ReactNode;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

// Operational sections where filtering by tenant is the natural
// scope. Both the list (`/farmers`) AND detail (`/farmers/:id`)
// pages render the switcher — detail pages still SHOW it but the
// trigger is locked to a static badge (handled inside CoopSwitcher
// via DETAIL_ROUTE_RE) so the user can't accidentally switch coop
// while looking at a single record.
//
// Anything outside these roots (`/admin/**`, `/profile`, etc.)
// hides the switcher entirely. Keep in sync with the route table
// in `apps/fe/src/index.tsx`.
const SWITCHER_ROOTS = [
  '/farmers',
  '/farms',
  '/inspections',
  '/training',
  '/coaching',
  '/purchases',
  '/primary-evacuation',
  '/secondary-evacuation',
  '/reports',
  '/notifications',
  '/vsla',
  '/clmrs',
];

export function AppHeader({ actions, locale, onLocaleChange }: AppHeaderProps) {
  const { pathname } = useLocation();
  // Strip a single trailing slash so `/farmers/` matches `/farmers`.
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  // Dashboard is the only path-equality match (everything starts with
  // `/`); for the operational sections we want list AND detail to
  // count, so prefix-match on each root.
  const showSwitcher =
    normalized === '/' ||
    SWITCHER_ROOTS.some((r) => normalized === r || normalized.startsWith(`${r}/`));

  return (
    // The sticky element is this wrapper, so the demo strip pins to the
    // viewport together with the header row instead of scrolling away.
    // Combined height (16px strip + 48px row = 64px) is what pinned page
    // content offsets against (`sticky top-16`).
    <div className="sticky top-0 z-40 shrink-0">
      <DemoBanner />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          {/* Force a foreground-compatible icon color — the ghost Button
            variant leaves the child icon at inherited color, which
            renders almost invisible on the dark topbar. `text-muted-
            foreground` matches the surrounding header icons (bell /
            user menu) and lifts to `text-foreground` on hover as the
            standard interactive cue. */}
          <SidebarTrigger className="-ml-1 shrink-0 text-muted-foreground hover:text-foreground" />
          <Separator orientation="vertical" className="!mx-1 !h-4 !self-center shrink-0" />
          {/* Breadcrumbs read from useBreadcrumbStore, populated by each page. */}
          <Breadcrumbs />
        </div>
        <div className="ml-auto flex items-center gap-2 px-4">
          {actions}
          {showSwitcher && <CoopSwitcher />}
          <NotificationMenu />
          <UserMenu locale={locale} onLocaleChange={onLocaleChange} />
        </div>
      </header>
    </div>
  );
}
