import { useParams } from 'react-router-dom';
import { InspectionDetailPageContent } from '../components/inspection-detail-page-content';

export function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <InspectionDetailPageContent inspectionId={id} />;
}
