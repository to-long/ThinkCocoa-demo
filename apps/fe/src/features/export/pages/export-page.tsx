/**
 * Export — placeholder page for the end of the traceability chain
 * (depot/port → export). Under construction; the real screen lands later.
 */

import { Ship } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

export function ExportPage() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('export.title') }]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('export.title')}</h1>
      </header>
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Ship className="size-7" aria-hidden="true" />
        </div>
        <p className="max-w-md text-muted-foreground text-sm">{t('export.underConstruction')}</p>
      </div>
    </div>
  );
}
