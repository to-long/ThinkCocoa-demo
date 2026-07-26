import { Navigate, useParams } from 'react-router-dom';
import { FarmerDetailPageContent } from '../components/farmer-detail-page-content';

export function FarmerDetailPage() {
  const { farmerId } = useParams<{ farmerId: string }>();
  if (!farmerId) return <Navigate to="/farmers" replace />;
  return <FarmerDetailPageContent farmerId={farmerId} />;
}
