'use client';
import { useState } from 'react';
import { useAccess } from '@/components/access-context';
import { AccountMenu } from '@/components/account-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { homeFor } from '@/lib/permissions';

export default function AccountForm() {
  const { user } = useAccess();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError('');
    if (data.get('password') !== data.get('confirm')) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/access/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: data.get('currentPassword'), password: data.get('password') }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error);
      window.location.assign(homeFor(user));
    } catch (err) { setError(err instanceof Error ? err.message : 'Please try again.'); setBusy(false); }
  }
  return <main className="access-shell"><header className="access-topbar"><a href="/"><img src="/tamam-logo.svg" alt="Tamam" /></a><AccountMenu /></header><div className="account-card"><span className="login-kicker">MY ACCOUNT</span><h1>{user.mustChangePassword ? 'Choose your own password' : user.name}</h1><p>@{user.username} · {user.roleName}</p><p>{user.mustChangePassword ? 'Replace your temporary password before opening the workspace.' : 'Update your password below. Other sessions will be signed out.'}</p><form className="access-form" onSubmit={submit}><label>Current password<Input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label><label>New password<Input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>At least 12 characters</small></label><label>Confirm new password<Input name="confirm" type="password" autoComplete="new-password" required maxLength={128} /></label>{error && <p className="access-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</Button></form>{!user.mustChangePassword && homeFor(user) !== '/account' && <a className="access-back" href={homeFor(user)}>Back to workspace →</a>}{!user.mustChangePassword && homeFor(user) === '/account' && <p>Your account is active. Ask IT to assign workspace permissions.</p>}</div></main>;
}
