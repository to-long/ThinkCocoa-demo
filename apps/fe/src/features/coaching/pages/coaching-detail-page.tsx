import { useParams } from 'react-router-dom';
import { CoachingDetailPageContent } from '../components/coaching-detail-page-content';

export function CoachingDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <CoachingDetailPageContent id={id} />;
}
