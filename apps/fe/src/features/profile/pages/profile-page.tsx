import { useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useLocation } from 'react-router-dom';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { AccountInfoForm } from '../components/account-info-form';
import { ChangePasswordForm } from '../components/change-password-form';
import { NotificationPreferencesForm } from '../components/notification-preferences-form';

export function ProfilePage() {
  const intl = useIntl();
  const location = useLocation();
  const t = (id: string) => intl.formatMessage({ id });
  useBreadcrumb([{ label: t('profile.breadcrumb') }]);

  // Bell dropdown's "Settings" deep-links here as
  // `/profile#notification`. Scroll the notification card into view
  // when the hash matches so the user lands on the right section.
  // The block id below matches the hash 1:1 so a plain anchor link
  // (`<a href="/profile#notification">`) works without JS too.
  useEffect(() => {
    if (location.hash !== '#notification') return;
    const el = document.getElementById('notification');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('profile.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('profile.subtitle')}</p>
      </div>
      {/* Account + password side-by-side on desktop (lg+); tablet and
          below stack them into a single column. `items-stretch` keeps
          both cards the same height. Inner Cards use `h-full` so they
          fill the stretched grid cell. */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <AccountInfoForm />
        <ChangePasswordForm />
      </div>
      <div id="notification" className="scroll-mt-16">
        <NotificationPreferencesForm />
      </div>
    </div>
  );
}
