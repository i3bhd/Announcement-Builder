import { pageUser } from '@/lib/access-server';
import { AccessProvider } from '@/components/access-context';
import Dashboard from './dashboard';
export const dynamic = 'force-dynamic';
export default async function DashboardPage() {
  const user = await pageUser('dashboard.view');
  return <AccessProvider user={user}><Dashboard /></AccessProvider>;
}
