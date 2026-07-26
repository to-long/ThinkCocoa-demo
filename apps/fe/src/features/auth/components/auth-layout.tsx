import { useIntl } from 'react-intl';
import { Link, Outlet } from 'react-router-dom';
import { DemoBanner } from '@/shared/components/composed/demo-banner';
import { SettingsMenu } from '@/shared/components/composed/settings-menu';
import type { Locale } from '@/shared/hooks/use-locale';

interface AuthLayoutProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function AuthLayout({ locale, onLocaleChange }: AuthLayoutProps) {
  const intl = useIntl();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DemoBanner />
      <header className="flex items-center justify-between border-border border-b px-8 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src="/cocoa-traceability.webp"
            alt="Think!Cocoa"
            className="size-7"
            width={28}
            height={28}
            decoding="async"
          />
          <div className="flex flex-col">
            <span className="font-semibold text-sm leading-tight text-foreground">Think!Cocoa</span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {intl.formatMessage({ id: 'brand.slogan' })}
            </span>
          </div>
        </Link>
        <SettingsMenu locale={locale} onLocaleChange={onLocaleChange} />
      </header>
      <main className="flex flex-1 items-center justify-center bg-muted p-6">
        <Outlet />
      </main>
    </div>
  );
}
