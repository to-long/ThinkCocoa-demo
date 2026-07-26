import { Settings } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import type { Locale } from '@/shared/hooks/use-locale';
import { PreferencesFields } from './preferences-fields';

interface SettingsMenuProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

/**
 * Gear-icon dropdown holding the language + theme pickers. Used on the
 * guest AuthLayout header (where there's no user menu to hang them off).
 * Mirrors the UserMenu popover shell.
 */
export function SettingsMenu({ locale, onLocaleChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex size-8 items-center justify-center rounded-md bg-accent text-foreground transition-colors hover:bg-sidebar-accent"
        aria-label="Settings"
      >
        <Settings className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[240px] p-0"
        showArrow
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 py-2.5">
          <span className="font-semibold text-foreground text-sm">Settings</span>
        </div>
        <Separator />
        <div className="p-3">
          <PreferencesFields locale={locale} onLocaleChange={onLocaleChange} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
