import { LogOut, Settings } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useSignOut } from '@/features/auth';
import { authClient } from '@/lib/auth-client';
import { avatarTintForName } from '@/lib/brand-palette';
import { PreferencesFields } from '@/shared/components/composed/settings-menu';
import type { Locale } from '@/shared/hooks/use-locale';

interface UserMenuProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function UserMenu({ locale, onLocaleChange }: UserMenuProps) {
  const signOut = useSignOut();
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
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

  // Teardown (auth + zustand + active-coop + notif cursor + SWR cache)
  // lives in `useSignOut` so the no-access screen runs the exact same
  // routine — see `features/auth/hooks/use-sign-out.ts`.
  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
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
        className="w-[264px] p-0"
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
            {t('common.menu.profileSettings')}
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
            {t('common.menu.signOut')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
