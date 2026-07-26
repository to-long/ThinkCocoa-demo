import { LogOut, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mutate as globalSwrMutate } from 'swr';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { authClient } from '@/lib/auth-client';
import { avatarTintForName } from '@/lib/brand-palette';
import { PreferencesFields } from '@/shared/components/composed/settings-menu';
import type { Locale } from '@/shared/hooks/use-locale';
import { resetActiveCoop } from '@/shared/store/useActiveCoop';
import { resetGlobalState } from '@/shared/store/useGlobalState';

interface UserMenuProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function UserMenu({ locale, onLocaleChange }: UserMenuProps) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const [open, setOpen] = useState(false);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : (user?.email?.slice(0, 2).toUpperCase() ?? '?');
  // Tint hashed off the user's name (or email fallback) so the
  // header avatar shows the same brand colour as the bell-dropdown
  // and audit-detail surfaces for this person — visual identity is
  // consistent across every avatar surface in the app.
  const avatarTint = avatarTintForName(user?.name ?? user?.email ?? '');

  const handleSignOut = async () => {
    setOpen(false);
    await authClient.signOut();
    // Wipe cached state so the next user's session doesn't inherit any
    // admin catalogs or identity from this one:
    //   - Global zustand store = identity + effective permissions.
    //   - SWR cache = users/roles/permissions lists + dialog catalogs.
    // The `() => true` matcher clears every key; `revalidate: false`
    // prevents SWR from re-fetching with the now-expired cookie.
    resetGlobalState();
    resetActiveCoop();
    // Drop the notification cursor too — `notif:lastSeenAuditId`
    // is per-user, but localStorage persists across sessions, so
    // user B logging in on the same browser would inherit user A's
    // cursor and silently see 0 unread until enough new events
    // accrue past A's high-water mark.
    try {
      window.localStorage.removeItem('notif:lastSeenAuditId');
    } catch {
      /* localStorage may be disabled in some browser modes */
    }
    await globalSwrMutate(() => true, undefined, { revalidate: false });
    navigate('/login');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex size-8 items-center justify-center rounded-full text-xs font-medium text-white"
        style={{ backgroundColor: avatarTint }}
      >
        {initials}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={0}
        className="w-[220px] p-0"
        showArrow
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 py-3">
          <div className="flex flex-col gap-0.5 overflow-hidden">
            <span className="truncate text-sm font-semibold text-foreground">
              {user?.name ?? 'User'}
            </span>
            <span className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</span>
          </div>
        </div>
        <Separator />
        {/* Language + Theme — shared segmented pickers (also used by the
            guest AuthLayout settings dropdown). */}
        <div className="p-3">
          <PreferencesFields locale={locale} onLocaleChange={onLocaleChange} />
        </div>
        <Separator />
        <div className="p-1">
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Settings className="size-4 text-foreground" />
            Profile Settings
          </Link>
        </div>
        <Separator />
        <div className="p-1">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-accent"
          >
            <LogOut className="size-4 text-destructive" />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
