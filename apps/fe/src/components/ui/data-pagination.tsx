import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard list-page pager — Pencil `wtVUq` (`pagerControls`). Four
 * bordered 28×28 chevron buttons (first / prev / next / last) flanking
 * an editable page-number input showing `[n] / N`. Same API as the
 * pre-Pencil version (page / totalPages / onPageChange / className)
 * so every existing call site (farmers, users, roles, permissions,
 * cooperatives, audit log) continues to work without touching the
 * page content.
 *
 * Renders nothing when `totalPages <= 1` — there's nothing to
 * navigate, and admins shouldn't see a disabled control just to
 * confirm "you're on page 1 of 1".
 */
interface DataPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Passes through to the wrapper `div`. Most callers leave it
   *  unset; pages that need to override the default flex behavior
   *  (e.g. inline next to a result counter) can still pass classes. */
  className?: string;
  /** Optional aria-labels — fall back to English defaults. */
  firstLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
  lastLabel?: string;
}

// Shared button styles for the four chevron controls. Borderless
// per Pencil — `stroke.fill.enabled: false` in the source — so each
// button is just the icon in a hover-tintable square. 28×28 with a
// 6px corner so the hover background fills cleanly.
const NAV_BTN =
  'flex size-7 items-center justify-center rounded-md ' +
  'text-muted-foreground hover:text-foreground hover:bg-muted ' +
  'disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

export function DataPagination({
  page,
  totalPages,
  onPageChange,
  className,
  firstLabel = 'First page',
  previousLabel = 'Previous',
  nextLabel = 'Next',
  lastLabel = 'Last page',
}: DataPaginationProps) {
  const [draft, setDraft] = useState(String(page));

  // Sync the input back to the canonical `page` prop whenever it
  // changes from outside (chevron clicks, filter resets, parent
  // reloads). While the user is mid-typing, `page` hasn't moved yet
  // so the effect doesn't fire and their draft sticks.
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  if (totalPages <= 1) return null;

  const commitDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 1) {
      setDraft(String(page));
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, Math.floor(n)));
    if (clamped !== page) onPageChange(clamped);
    setDraft(String(clamped));
  };

  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    // Pencil gap=4 between buttons, gap=8 inside the page input cluster.
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        aria-label={firstLabel}
        disabled={atFirst}
        onClick={() => onPageChange(1)}
        className={NAV_BTN}
      >
        <ChevronsLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label={previousLabel}
        disabled={atFirst}
        onClick={() => onPageChange(page - 1)}
        className={NAV_BTN}
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="flex items-baseline gap-2 px-1 text-[14px]">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D+/g, ''))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-7 w-7 border-b border-border bg-transparent text-center font-medium text-foreground outline-none focus:border-foreground"
          aria-label="Page"
        />
        {/* Lighter `#c0c0c0` per Pencil — distinct from the standard
            muted-foreground used elsewhere in the row. */}
        <span className="text-[#c0c0c0]">/ {totalPages}</span>
      </div>
      <button
        type="button"
        aria-label={nextLabel}
        disabled={atLast}
        onClick={() => onPageChange(page + 1)}
        className={NAV_BTN}
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        aria-label={lastLabel}
        disabled={atLast}
        onClick={() => onPageChange(totalPages)}
        className={NAV_BTN}
      >
        <ChevronsRight className="size-4" />
      </button>
    </div>
  );
}
