import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/access-server';
import { hasPermission, homeFor } from '@/lib/permissions';
import { AccessProvider } from '@/components/access-context';
import Builder from './builder';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await pageUser();
  if (!hasPermission(user, 'builder.view') || (!hasPermission(user, 'template.service') && !hasPermission(user, 'template.general'))) redirect(homeFor(user));
  return <AccessProvider user={user}><Builder /></AccessProvider>;
}
