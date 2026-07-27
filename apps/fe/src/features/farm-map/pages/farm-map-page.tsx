import { useIntl } from 'react-intl';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { FarmMapPageContent } from '../components/farm-map-page-content';

export function FarmMapPage() {
  const intl = useIntl();
  useBreadcrumb([
    { label: intl.formatMessage({ id: 'navigation.farms' }), href: '/farms' },
    { label: intl.formatMessage({ id: 'farmMap.title' }) },
  ]);
  return <FarmMapPageContent />;
}
