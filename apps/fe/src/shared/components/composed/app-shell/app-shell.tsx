import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppHeader } from '@/shared/components/composed/app-header';
import { AppSidebar } from '@/shared/components/composed/app-sidebar';
import { useTrackLastMenuRoute } from '@/shared/hooks/use-last-menu-route';
import type { Locale } from '@/shared/hooks/use-locale';

interface AppShellProps {
  children: ReactNode;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function AppShell({ children, locale, onLocaleChange }: AppShellProps) {
  // Record every non-notification route so the notification list's
  // Back button has a meaningful target. Lives at the shell so the
  // tracker mounts once per session, not per page.
  useTrackLastMenuRoute();

  return (
    // `--sidebar-width` is the CSS var the shadcn sidebar primitive
    // uses to size the desktop rail (default 16rem / 256 px). Override
    // it here so the entire app gets a tighter 200 px left menu; the
    // mobile drawer width (`SIDEBAR_WIDTH_MOBILE` inside the primitive)
    // is set via a separate style prop and stays at its wider default,
    // which is what you want for touch-friendly drawer tap targets.
    <SidebarProvider style={{ '--sidebar-width': '200px' } as React.CSSProperties}>
      <AppSidebar />
      {/* `min-w-0` on the inset (a flex child sitting next to the
          sidebar) lets it shrink below its intrinsic content width.
          Without it the inset stays at least as wide as its widest
          child (e.g. a wide data table) and pushes the page past the
          viewport, producing a page-level horizontal scrollbar. With
          `min-w-0` the inset is allowed to shrink and the constraint
          propagates down through the inner `<main>` to the table's
          own `overflow-x-auto` scroll container. */}
      <SidebarInset className="min-w-0">
        <AppHeader locale={locale} onLocaleChange={onLocaleChange} />
        {/* `min-w-0` again on this inner flex child for the same
            reason — defence in depth so any future wrapper between
            the inset and the page content can't reintroduce the
            overflow. Pages that need horizontal scroll wrap their
            wide content in their own `overflow-x-auto` container. */}
        <main className="flex-1 min-w-0 px-6 py-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
