import { useParams } from 'react-router-dom';
import { TrainingDetailPageContent } from '../components/training-detail-page-content';

export function TrainingDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <TrainingDetailPageContent id={id} />;
}
