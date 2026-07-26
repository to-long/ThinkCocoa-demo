import { useParams } from 'react-router-dom';
import { CooperativeDetailPageContent } from '../components/cooperatives/cooperative-detail-page-content';

export function AdminCooperativeDetailPage() {
  const { cooperativeId } = useParams<{ cooperativeId: string }>();
  if (!cooperativeId) return null;
  return <CooperativeDetailPageContent cooperativeId={cooperativeId} />;
}
