import { useParams } from 'react-router-dom';
import { UserDetailPageContent } from '../components/users/user-detail-page-content';

export function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  return <UserDetailPageContent clerkUserId={userId ?? ''} />;
}
