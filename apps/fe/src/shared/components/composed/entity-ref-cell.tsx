/**
 * Two-line "entity reference" table cell — the repeating
 * name-over-linked-code pattern used on every list page:
 *
 *     Andrews Baah Kofi          ← display name (bold)
 *     AS-AK001WP009 ↗            ← code (mono, muted) + cross-ref link
 *
 * `FarmerRefCell` links the code to `/farmers/:code` (gated by
 * `farmer:read`); `ParcelRefCell` links to `/farms/:code` (gated by
 * `parcel:read`). Both wrap the same internal `EntityRefCell`.
 *
 * `name` and `code` are both `ReactNode`, so the same two-line rhythm
 * covers cells that aren't a name/code pair at all — a timestamp
 * (`StackedDateTime`), or an action chip over an IP in the audit table.
 *
 * Behaviour:
 *   - No code → renders the name (or "—") as plain text; no link.
 *   - No name → renders just the linked code on one line (e.g. an
 *     inspection parcel that carries an ID but no resolved name).
 *   - Missing `farmer:read` / `parcel:read` → code shows as plain
 *     muted text (PermissionGate fallback), no navigation.
 *   - Rendered inside a row whose <tr> has its own onClick? Pass
 *     `stopRowClick` so the link's click doesn't also fire the row
 *     handler (double navigation).
 */

import type { PermissionCode } from '@kuanadata/shared';
import { SquareArrowOutUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PermissionGate } from '@/features/auth';
import { LIST_SUB_LINK } from '@/lib/link-styles';
import { cn } from '@/lib/utils';

interface EntityRefCellProps {
  /** Display-only, so a caller can decorate it (badge, icon, tooltip). */
  name: ReactNode;
  /**
   * The code line. A plain string doubles as the route segment; pass a
   * ReactNode to decorate it and supply `codeValue` for the URL.
   */
  code: ReactNode;
  /** Route segment when `code` isn't a plain string. */
  codeValue?: string | null;
  /** Route the code links to, e.g. `/farmers` or `/farms`. The code
   *  is appended (URL-encoded) as the final segment. Omit for a
   *  link-less cell that only wants the two-line layout. */
  basePath?: string;
  /** Permission that gates the link. Without it, the code renders as
   *  plain muted text. */
  permission?: PermissionCode;
  /** Add `stopPropagation` to the link click — set when the row's
   *  <tr> is itself clickable. */
  stopRowClick?: boolean;
  /** Extra muted text appended after the code (e.g. the enumerator who
   *  collected a VSLA group's reports). Rendered inside the same line. */
  meta?: ReactNode;
  /** Horizontal alignment — `end` for numeric columns. Default `start`. */
  align?: 'start' | 'end';
  /** Trailing control pinned to the FIRST line (e.g. the audit table's
   *  "apply to filter" arrow). On the first line rather than beside the
   *  block so it aligns with the title, not the two lines' midpoint. */
  action?: ReactNode;
}

/** `title` is only useful when the node is text we may have ellipsized. */
function titleOf(v: ReactNode): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Generic two-line cell (name over code). Exported so callers that only
 * want the layout — no cross-ref link — can omit `basePath`.
 */
export function RefCell({
  name,
  code,
  codeValue,
  basePath,
  permission,
  stopRowClick,
  meta,
  align = 'start',
  action,
}: EntityRefCellProps) {
  // leading-tight + a 4px gap so the name + code read as one two-line
  // block (matches the CLMRS / coaching cells). `min-w-0` is what lets the
  // truncation below actually bite inside a fixed-width column.
  const wrap = (children: ReactNode) => (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 leading-tight',
        align === 'end' ? 'items-end text-right' : 'items-start',
      )}
    >
      {children}
    </div>
  );

  // Both lines ellipsize rather than wrap: these cells live in columns with
  // a fixed width, and a long name pushing the row to three lines breaks
  // the table's rhythm.
  const line = (node: ReactNode, className: string, title?: string) => (
    <span className={cn('min-w-0 max-w-full flex-1 truncate', className)} title={title}>
      {node}
    </span>
  );

  // The first line is a FIXED 20px box, always. Its content varies wildly —
  // plain text (17.5px), a status chip (19.25px), a 20px icon button — and
  // letting each one set its own height is what made the 4px gap *look*
  // different from cell to cell even though it never changed. Pinning the
  // line means every stacked cell in a row is 20 + 4 + text.
  // `action` rides this line, so a name-less cell still gets its control.
  const firstLine = (node: ReactNode) => (
    <span className="flex h-5 w-full min-w-0 items-center gap-1">
      {node}
      {action}
    </span>
  );

  if (!code) {
    // No code → plain (muted) single line; deliberately not bold, it has
    // no reference to point at.
    return wrap(firstLine(line(name ?? '—', 'text-muted-foreground text-sm', titleOf(name))));
  }

  // Route segment: an explicit `codeValue`, else `code` when it's a plain
  // string. No basePath (or nothing routable) → plain text, not a dead
  // link.
  const segment = codeValue ?? (typeof code === 'string' ? code : null);
  const href = basePath && segment ? `${basePath}/${encodeURIComponent(segment)}` : null;
  const plainCode = line(code, 'font-mono text-[11px] text-muted-foreground', titleOf(code));

  const codeLink = !href ? (
    plainCode
  ) : (
    <PermissionGate codes={permission ? [permission] : []} fallback={plainCode}>
      <Link
        to={href}
        onClick={stopRowClick ? (e) => e.stopPropagation() : undefined}
        className={cn(LIST_SUB_LINK, 'max-w-full')}
        title={titleOf(code)}
      >
        <span className="min-w-0 truncate">{code}</span>
        <SquareArrowOutUpRight className="size-3 shrink-0" />
      </Link>
    </PermissionGate>
  );

  const codeLine = meta ? (
    <span className="flex min-w-0 max-w-full items-center gap-1">
      {codeLink}
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">· {meta}</span>
    </span>
  ) : (
    codeLink
  );

  // No name → the code becomes the first line (e.g. a parcel with only an
  // ID) and keeps that line's height.
  if (!name) return wrap(firstLine(codeLine));

  return wrap(
    <>
      {firstLine(line(name, 'font-medium', titleOf(name)))}
      {codeLine}
    </>,
  );
}

export function FarmerRefCell(props: {
  farmerName: string | null | undefined;
  farmerCode: string | null | undefined;
  stopRowClick?: boolean;
}) {
  return (
    <RefCell
      name={props.farmerName}
      code={props.farmerCode}
      basePath="/farmers"
      permission="farmer:read"
      stopRowClick={props.stopRowClick}
    />
  );
}

export function VslaRefCell(props: {
  groupName: string | null | undefined;
  /** `group_number` (e.g. `ABM-001`) — the BE detail route resolves it. */
  groupNumber: string | null | undefined;
  stopRowClick?: boolean;
}) {
  return (
    <RefCell
      name={props.groupName}
      code={props.groupNumber}
      basePath="/vsla"
      permission="vsla:read"
      stopRowClick={props.stopRowClick}
    />
  );
}

export function ParcelRefCell(props: {
  parcelName: string | null | undefined;
  parcelId: string | null | undefined;
  stopRowClick?: boolean;
}) {
  return (
    <RefCell
      name={props.parcelName}
      code={props.parcelId}
      basePath="/farms"
      permission="parcel:read"
      stopRowClick={props.stopRowClick}
    />
  );
}
