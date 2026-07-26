import { Monitor, Moon, Sun } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type ThemePreference, useAppTheme } from '@/shared/hooks/use-app-theme';
import { type Locale, localeFlags, locales } from '@/shared/hooks/use-locale';

interface PreferencesFieldsProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

/**
 * Language + Theme segmented pickers. Shared by the authenticated
 * UserMenu dropdown and the guest AuthLayout SettingsMenu so both stay
 * in lockstep. Theme state is owned by `useAppTheme` (localStorage), so
 * only the locale needs to be threaded through props.
 */
export function PreferencesFields({ locale, onLocaleChange }: PreferencesFieldsProps) {
  const { theme, setTheme } = useAppTheme();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Language</span>
        <Tabs value={locale} onValueChange={(v) => onLocaleChange(v as Locale)}>
          <TabsList className="grid w-full grid-cols-3">
            {locales.map((l) => (
              <TabsTrigger key={l} value={l} className="gap-1 text-xs">
                <span>{localeFlags[l]}</span>
                {l.toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Theme</span>
        <Tabs value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="light" className="gap-1 text-xs">
              <Sun className="size-3.5" />
              Light
            </TabsTrigger>
            <TabsTrigger value="dark" className="gap-1 text-xs">
              <Moon className="size-3.5" />
              Dark
            </TabsTrigger>
            <TabsTrigger value="system" className="gap-1 text-xs">
              <Monitor className="size-3.5" />
              System
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
