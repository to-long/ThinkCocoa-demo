/**
 * One row in the notification dropdown — matches Pencil `EtEyC`
 * (unread / accent bg) and `chTqx` (read).
 *
 * Layout:
 *   [avatar 28×28]  Name (12/600) · time (11)
 *                   {pre-built event line}            (11 muted)
 *
 * Caller composes the event line so we can route around the
 * `summary`-vs-snapshot duplicate-verb case (parent handles the
 * branch). Avatar tint hashes off `actorName` so the same person
 * renders the same color across the bell, list, and detail
 * screens. `unread` paints the accent background.
 */

import { avatarTintForName } from '@/lib/brand-palette';

interface NotificationMenuItemProps {
  /** Full name of the user who fired the audit event. */
  actorName: string;
  /** Pre-built event line, e.g. "update Farmer Mensah John". */
  text: string;
  /** Pre-formatted timestamp ("30 min ago" / "2024-01-14 13:55"). */
  time: string;
  unread?: boolean;
  /** Click handler — caller wires to navigate(`/notifications/${auditId}`). */
  onClick?: () => void;
}

// Avatar tint + initials helpers live in `@/lib/brand-palette` so the
// sidebar, notification dropdown, and audit-log detail page all draw
// from one source. `avatarTintForName` hashes deterministically — the
// same actor always picks the same stop within a session.
function actorInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function NotificationMenuItem({
  actorName,
  text,
  time,
  unread = false,
  onClick,
}: NotificationMenuItemProps) {
  const tint = avatarTintForName(actorName);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded p-1 text-left transition-colors hover:bg-sidebar-accent ${unread ? 'bg-accent' : ''}`}
    >
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: tint }}
      >
        {actorInitials(actorName)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Row 1 — actor + time */}
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[12px] font-semibold text-foreground">{actorName}</span>
          <span className="text-[12px] text-muted-foreground">·</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{time}</span>
        </div>
        {/* Row 2 — event line */}
        <span className="truncate text-[11px] text-muted-foreground">{text}</span>
      </div>
    </button>
  );
}
