import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/access-server';
import { hasPermission } from '@/lib/permissions';
import { AccessProvider } from '@/components/access-context';
import AdminPanel from './panel';

export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const user = await pageUser();
  if (!hasPermission(user, 'users.manage') && !hasPermission(user, 'roles.manage')) redirect('/account');
  return <AccessProvider user={user}><AdminPanel /></AccessProvider>;
}
