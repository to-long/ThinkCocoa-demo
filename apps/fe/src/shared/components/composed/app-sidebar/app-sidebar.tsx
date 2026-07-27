import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useLocation } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { brandTintForTheme } from '@/lib/brand-palette';
import { cn } from '@/lib/utils';
import { useAppTheme } from '@/shared/hooks/use-app-theme';
import { selectCurrentUserPermissions, useGlobalState } from '@/shared/store/useGlobalState';
import { menuSections } from './menu-settings';

/**
 * Sections whose content is always visible — the label row is a plain
 * non-interactive header, no chevron, no toggle. These are the "primary"
 * day-to-day sections the user should never have to re-open. Everything
 * NOT in this set participates in the single-select accordion.
 */
const ALWAYS_OPEN_SECTIONS = new Set<string>([
  'sidebar.main',
  'sidebar.operations',
  'sidebar.traceability',
  'sidebar.compliance',
  'sidebar.reporting',
  'sidebar.admin',
]);

export function AppSidebar() {
  const { pathname } = useLocation();
  const intl = useIntl();
  const { isDark } = useAppTheme();
  const userPerms = useGlobalState(selectCurrentUserPermissions);
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  const t = (key: string) => intl.formatMessage({ id: key });

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  // Auto-close the mobile drawer after route navigation. The effect
  // key is `pathname` ONLY — not `openMobile` — otherwise every time
  // the user taps the trigger to OPEN the drawer, this effect fires
  // on the true→ transition and immediately slams it back shut
  // before the sheet finishes rendering. That was the original mobile
  // "menu doesn't open" bug.
  // Auto-close the mobile drawer after route navigation. `pathname` is
  // the ONLY intended trigger — adding openMobile/isMobile makes the
  // effect fire on the false→true transition and slam the drawer shut
  // as soon as the user opens it (original "menu doesn't open" bug).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (isMobile && openMobile) {
      setOpenMobile(false);
    }
  }, [pathname]);

  // Filter items by user's effective permissions, then drop sections that
  // end up empty — prevents orphaned section headers with no rows under
  // them. Items without a `permission` field (e.g. future "always-on"
  // rows) pass through unconditionally. Relies on `ProtectedRoute` having
  // already awaited bootstrap so `userPerms` is populated here.
  const visibleSections = useMemo(() => {
    const perms = new Set(userPerms ?? []);
    return menuSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || perms.has(item.permission)),
      }))
      .filter((section) => section.items.length > 0);
  }, [userPerms]);

  // ── Accordion state ──────────────────────────────────────────────
  // At most ONE *toggleable* section is expanded at a time. Sections
  // in `ALWAYS_OPEN_SECTIONS` are excluded from the accordion entirely
  // — they stay rendered full-height regardless of expandedKey.
  //
  // Initial value: whichever toggleable section contains the current
  // route (so a user landing on /roles sees IAM pre-opened). If the
  // route is in an always-open section (or no route matches), pick
  // the first toggleable section so the accordion column isn't fully
  // collapsed on first paint.
  const [expandedKey, setExpandedKey] = useState<string | null>(() => {
    const toggleable = visibleSections.filter((s) => !ALWAYS_OPEN_SECTIONS.has(s.labelKey));
    const match = toggleable.find((s) => s.items.some((it) => isActive(it.href)));
    return match?.labelKey ?? toggleable[0]?.labelKey ?? null;
  });

  // Keep the accordion in sync with navigation: if the user lands on a
  // route that's inside a different *toggleable* section than the one
  // currently expanded, auto-switch. Routes inside always-open sections
  // don't touch accordion state (no reason to collapse IAM just because
  // the user clicked a Farmers row).
  useEffect(() => {
    const match = visibleSections.find(
      (s) =>
        !ALWAYS_OPEN_SECTIONS.has(s.labelKey) &&
        s.items.some((it) =>
          it.href === '/'
            ? pathname === '/'
            : pathname === it.href || pathname.startsWith(`${it.href}/`),
        ),
    );
    if (match && match.labelKey !== expandedKey) {
      setExpandedKey(match.labelKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, visibleSections, expandedKey]);

  const toggleSection = (key: string) => {
    // Click on the open section → collapse everything. Click on a
    // different section → switch to it.
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  return (
    // The base Sidebar primitive hardcodes `z-10` on its fixed
    // desktop container; our AppHeader sits at `z-40` (sticky). Bumping
    // the sidebar to z-50 lets its fly-out menus / dropdowns render
    // ABOVE the topbar (and above any breadcrumb row) instead of being
    // clipped behind it. `cn()` via tailwind-merge resolves the two
    // z-* classes for the same axis — our `z-50` wins.
    // `collapsible="icon"` — collapsing leaves the icon rail rather than
    // taking the whole sidebar off-canvas. Off-canvas (the primitive's
    // default) hid navigation completely on a desktop screen, where nothing
    // then suggests the menu is only collapsed. The header and the section
    // labels already carry `group-data-[collapsible=icon]:hidden`, so they
    // fold away and the icons stay.
    <Sidebar collapsible="icon" className="z-50">
      {/* `pl-4` frames the logo + wordmark when expanded, but in the 48px
          icon rail it shoves the mark off-centre and into the header's
          overflow clip — so collapsed falls back to symmetric padding and
          centres the row. */}
      <SidebarHeader className="pl-4 pt-2 group-data-[collapsible=icon]:pl-2">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:justify-center"
        >
          <img
            src="/ThinkCocoaLogo.webp"
            alt="Think!Cocoa"
            // `shrink-0` — the mark is a flex child, so without it the
            // cramped collapsed row squeezes its width while the height
            // stays, stretching a square (512×512) source.
            className="size-7 shrink-0"
            width={28}
            height={28}
            decoding="async"
          />
          {/* `min-w-0` — without it a flex child refuses to shrink below its
              content width, so `truncate` never engages and the wordmark
              pushes the header wider instead. Both lines are single-line by
              contract: the brand name must never wrap, and the slogan is
              longer than the 200px rail at most locales, so it ellipsises. */}
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate font-semibold text-sm leading-tight text-sidebar-foreground">
              Think!Cocoa
            </span>
            <span className="truncate text-[10px] leading-tight text-muted-foreground">
              {t('brand.slogan')}
            </span>
          </div>
        </Link>
      </SidebarHeader>
      {/* Overrides stacked to compact the sidebar:
          - SidebarContent  `gap-0`    → removes the stock `gap-2` between
                                         groups so sections sit flush.
          - SidebarContent  `pb-6`     → 24 px breathing room below the
                                         last item so it doesn't hug the
                                         viewport floor.
          - SidebarGroup    `py-0`     → drops group's own vertical
                                         padding entirely.
          - SidebarMenu     `gap-0.5`  → halves the inter-item gap from
                                         4 px → 2 px. */}
      <SidebarContent className="gap-0 pb-6">
        {visibleSections.map((section, sectionIndex) => {
          const alwaysOpen = ALWAYS_OPEN_SECTIONS.has(section.labelKey);
          const isExpanded = alwaysOpen || expandedKey === section.labelKey;
          // `px-1` when collapsed (vs the stock `px-2`) hands the spare 8px
          // to the buttons, so a row is 40px wide instead of 31 — still a 4px
          // inset so the active pill doesn't bleed into the rail edges.
          return (
            <SidebarGroup
              key={section.labelKey}
              className="py-0 group-data-[collapsible=icon]:px-1"
            >
              {/* Collapsed to the icon rail, the group LABELS are hidden —
                  which leaves one undifferentiated column of icons. A rule
                  takes over their job of marking where a group starts. Only
                  between groups, so the first one keeps a clean top edge. */}
              {sectionIndex > 0 && (
                <div
                  aria-hidden="true"
                  className="mx-2 my-1.5 hidden border-sidebar-border border-t group-data-[collapsible=icon]:block"
                />
              )}
              {/* Always-open sections: plain label, no chevron, no
                  click handler. Toggleable sections: wrap the label in
                  an `asChild` button so the whole row is a click
                  target + chevron rotates when collapsed. */}
              {alwaysOpen ? (
                <SidebarGroupLabel className="text-sidebar-foreground/55">
                  {t(section.labelKey)}
                </SidebarGroupLabel>
              ) : (
                <SidebarGroupLabel
                  asChild
                  className="text-sidebar-foreground/55 hover:text-sidebar-foreground/60"
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(section.labelKey)}
                    aria-expanded={isExpanded}
                    className="flex w-full cursor-pointer items-center justify-between"
                  >
                    <span>{t(section.labelKey)}</span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 transition-transform duration-150',
                        !isExpanded && '-rotate-90',
                      )}
                    />
                  </button>
                </SidebarGroupLabel>
              )}
              {isExpanded && (
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {section.items.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.href)}
                          tooltip={t(item.labelKey)}
                          className={cn(
                            'px-2 py-1.5 text-[13px] text-sidebar-foreground/80 hover:text-sidebar-foreground data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm dark:data-[active=true]:bg-white/10',
                            // Collapsed, the primitive pins the button to a
                            // 32px square (`size-8!`), so only the icon
                            // itself was clickable. `!` to outrank it: the
                            // row fills the rail and stands 36px tall — a
                            // real target. The label then has to be hidden
                            // EXPLICITLY: the primitive never hides it, it
                            // just relies on the square's overflow clip, so
                            // a wider button leaks the first letter of every
                            // label.
                            'group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:h-9! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:[&>span]:hidden',
                          )}
                        >
                          {/* No hover/focus prefetch here — every route is
                            warmed by `route-warmup` once the current screen
                            has finished loading. */}
                          <Link to={item.href}>
                            <item.icon
                              className="size-4 shrink-0"
                              style={{ color: brandTintForTheme(item.iconColor, isDark) }}
                            />
                            <span>{t(item.labelKey)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
