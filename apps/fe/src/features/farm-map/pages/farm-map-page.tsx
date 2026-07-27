import { useIntl } from 'react-intl';
import { PlaceholderListPage } from '@/shared/components/composed/placeholder-list-page';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';

export function FarmMapPage() {
  const intl = useIntl();
  useBreadcrumb([{ label: intl.formatMessage({ id: 'navigation.farms' }) }]);
  return <PlaceholderListPage titleKey="navigation.farms" />;
}
