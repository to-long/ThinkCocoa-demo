import { Navigate, useParams } from 'react-router-dom';
import { FarmDetailPageContent } from '../components/farm-detail-page-content';

export function FarmDetailPage() {
  const { parcelId } = useParams<{ parcelId: string }>();
  if (!parcelId) return <Navigate to="/farms" replace />;
  return <FarmDetailPageContent parcelId={parcelId} />;
}
