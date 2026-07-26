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

import type { PermissionCode } from '@cocoaimpact/shared';
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
}: EntityRefCellProps) {
  if (!code) {
    return <span className="text-muted-foreground text-sm">{name ?? '—'}</span>;
  }

  // Route segment: an explicit `codeValue`, else `code` when it's a plain
  // string. No basePath (or nothing routable) → plain text, not a dead
  // link.
  const segment = codeValue ?? (typeof code === 'string' ? code : null);
  const href = basePath && segment ? `${basePath}/${encodeURIComponent(segment)}` : null;
  const plainCode = <span className="font-mono text-[11px] text-muted-foreground">{code}</span>;

  const codeLink = !href ? (
    plainCode
  ) : (
    <PermissionGate codes={permission ? [permission] : []} fallback={plainCode}>
      <Link
        to={href}
        onClick={stopRowClick ? (e) => e.stopPropagation() : undefined}
        className={LIST_SUB_LINK}
      >
        {code}
        <SquareArrowOutUpRight className="size-3" />
      </Link>
    </PermissionGate>
  );

  const codeLine = meta ? (
    <span className="inline-flex items-center gap-1">
      {codeLink}
      <span className="font-mono text-[11px] text-muted-foreground">· {meta}</span>
    </span>
  ) : (
    codeLink
  );

  // No name → single linked-code line (e.g. parcel with only an ID).
  if (!name) return codeLine;

  return (
    // leading-tight + a 4px gap so the name + code read as one two-line
    // block (matches the CLMRS / coaching cells).
    <div
      className={cn(
        'flex flex-col gap-1 leading-tight',
        align === 'end' ? 'items-end' : 'items-start',
      )}
    >
      <span className="font-medium">{name}</span>
      {codeLine}
    </div>
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
