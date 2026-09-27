import { redirect } from 'next/navigation';
import { sessionUser } from '@/lib/access-server';
import { AccessProvider } from '@/components/access-context';
import AccountForm from './account-form';

export const dynamic = 'force-dynamic';
export default async function AccountPage() {
  const user = await sessionUser();
  if (!user) redirect('/login');
  return <AccessProvider user={user}><AccountForm /></AccessProvider>;
}
