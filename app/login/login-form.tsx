'use client';

import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { homeFor, type SessionUser } from '@/lib/permissions';

export default function LoginForm({ setup }: { setup: boolean }) {
  const [username, setUsername] = useState(setup ? 'technology' : '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (setup && password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/access/${setup ? 'setup' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, ...(setup ? { setupToken } : {}) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error);
      const me = await fetch('/api/access/me', { cache: 'no-store' }).then(r => r.json()) as { user: SessionUser | null };
      if (!me.user) throw new Error('Unable to start your session. Please try again.');
      window.location.assign(me.user.mustChangePassword ? '/account' : homeFor(me.user));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.'); setBusy(false); }
  }
  return <main className="login-shell">
    <section className="login-brand">
      <img className="login-logo" src="/tamam-logo.svg" alt="Tamam" />
      <div className="login-brand-copy"><span className="login-kicker">TAMAM COMMUNICATIONS</span><p dir="rtl" lang="ar">رسالتك، بكل وضوح.</p><h1>Clear messages.<br />One connected team.</h1><div className="login-brand-caption">Your space for thoughtful, consistent<br />communication across Tamam.</div></div>
      <div className="login-brand-footer"><span>Announcement Builder</span><span>تواصل داخلي</span></div>
    </section>
    <section className="login-content"><div className="login-card">
      <div className="login-icon">{setup ? <ShieldCheck /> : <LockKeyhole />}</div>
      <span className="login-kicker">{setup ? 'IT ADMINISTRATOR' : 'TEAM ACCESS'}</span>
      <h2>{setup ? 'Set up your workspace' : 'Welcome back'}</h2>
      <p>{setup ? 'Create the IT administrator password. You can then add department accounts and decide what each team can access.' : 'Sign in with the department account provided by IT.'}</p>
      <form onSubmit={submit}>
        {setup && <><label htmlFor="setup-token">Server setup key</label><Input id="setup-token" type="password" autoComplete="off" value={setupToken} onChange={e => setSetupToken(e.target.value)} required /><small className="access-hint">Use the one-time key configured by your server administrator.</small></>}
        <label htmlFor="username">Username</label><Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} readOnly={setup} placeholder="e.g. marketing" required maxLength={40} />
        <label htmlFor="password">{setup ? 'Create password' : 'Password'}</label><div className="password-input"><Input id="password" type={show ? 'text' : 'password'} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required /><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button></div>
        {setup && <><small className="access-hint">Use at least 12 characters.</small><label htmlFor="confirm">Confirm password</label><Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></>}
        {error && <p className="access-error" role="alert">{error}</p>}
        <Button type="submit" className="login-submit" disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create IT administrator' : 'Sign in'}<ArrowRight /></Button>
      </form>
      <div className="login-help">{setup ? 'The setup key protects creation of your first administrator account.' : 'Need access or a password reset? Contact your IT administrator.'}</div>
    </div><p className="login-copyright">Tamam · Internal communication workspace</p></section>
  </main>;
}
