import { redirect } from 'next/navigation';
import { sessionUser, setupAvailable } from '@/lib/access-server';
import { homeFor } from '@/lib/permissions';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  const user = await sessionUser();
  if (user) redirect(user.mustChangePassword ? '/account' : homeFor(user));
  return <LoginForm setup={await setupAvailable()} />;
}
