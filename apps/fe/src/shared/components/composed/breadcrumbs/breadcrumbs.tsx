/**
 * Renders the breadcrumb trail set by the active page via `useBreadcrumb`.
 *
 * Intentionally not a shadcn `<Breadcrumb>` wrapper — the topbar only needs
 * a compact one-line trail with a chevron separator. Keeps markup trivial.
 */

import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { selectBreadcrumbItems, useBreadcrumbStore } from '@/shared/contexts/breadcrumb-context';

export function Breadcrumbs() {
  const items = useBreadcrumbStore(selectBreadcrumbItems);
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 overflow-hidden text-muted-foreground text-sm"
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        // Each crumb caps at 300px so a single ridiculously-long label
        // (e.g. a user's full name) ellipsizes instead of pushing the
        // bar past the viewport.
        return (
          <span
            key={item.href || item.label}
            className="flex min-w-0 max-w-[300px] items-center gap-1"
          >
            {item.href && !isLast ? (
              <Link to={item.href} className="truncate transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'truncate font-medium text-foreground' : 'truncate'}>
                {item.label}
              </span>
            )}
            {!isLast && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />}
          </span>
        );
      })}
    </nav>
  );
}
