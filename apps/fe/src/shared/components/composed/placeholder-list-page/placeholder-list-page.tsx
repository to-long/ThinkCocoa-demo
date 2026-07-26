/**
 * Stub list page used for routes whose feature isn't built yet.
 * Renders the title + an "under construction" line — nothing else.
 */

import { useIntl } from 'react-intl';

interface PlaceholderListPageProps {
  /** Intl key for the h1 / breadcrumb tail. */
  titleKey: string;
}

export function PlaceholderListPage({ titleKey }: PlaceholderListPageProps) {
  const intl = useIntl();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">
        {intl.formatMessage({ id: titleKey })}
      </h1>
      <p className="text-muted-foreground">This page is under construction.</p>
    </div>
  );
}
