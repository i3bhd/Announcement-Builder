'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Check, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AccountMenu } from '@/components/account-menu';
import { useAccess } from '@/components/access-context';
import { PERMISSION_GROUPS, homeFor, type Permission } from '@/lib/permissions';

type User = { id: string; name: string; username: string; roleId: string; active: number; mustChangePassword: number };
type Role = { id: string; name: string; description: string; permissions: Permission[]; assignedCount: number };
type UserForm = { id?: string; name: string; username: string; roleId: string; active: boolean; password: string };
type RoleForm = { id?: string; name: string; description: string; permissions: Permission[] };

export default function AdminPanel() {
  const { user, can } = useAccess();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [userForm, setUserForm] = useState<UserForm | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  async function confirmDeleteRole() {
    if (!deleteRole) return;
    setBusy(true); setFormError('');
    try {
      const response = await fetch('/api/access/roles', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deleteRole.id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error);
      setDeleteRole(null); setNotice('Role deleted.'); await load();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not delete this role.'); }
    finally { setBusy(false); }
  }
  async function load() {
    setError('');
    try {
      const response = await fetch('/api/access/admin', { cache: 'no-store' });
      const data = await response.json() as { error?: string; users: User[]; roles: Role[] }; if (!response.ok) throw new Error(data.error);
      setUsers(data.users); setRoles(data.roles);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load accounts.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function save(action: string, body: unknown, message: string) {
    setFormError(''); setBusy(true);
    try {
      const response = await fetch(`/api/access/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error);
      setUserForm(null); setRoleForm(null); setResetUser(null); setResetPassword(''); setNotice(message); await load();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not save. Please try again.'); }
    finally { setBusy(false); }
  }
  const visibleUsers = users.filter(u => `${u.name} ${u.username}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="access-shell"><header className="access-topbar"><a href="/"><img src="/tamam-logo.svg" alt="Tamam" /></a><div><a className="access-back" href={homeFor(user)}><ArrowLeft size={16} /> Workspace</a><AccountMenu /></div></header>
    <div className="admin-content"><div className="admin-heading"><div><span className="login-kicker">WORKSPACE ADMINISTRATION</span><h1>People & permissions</h1><p>Create a role, select its permissions, then assign it to department accounts.</p></div></div>
      <div className="admin-stats">{can('users.manage') && <><div><Users /><span><b>{users.length}</b>Department accounts</span></div><div><Check /><span><b>{users.filter(u => u.active).length}</b>Active accounts</span></div></>}<div><ShieldCheck /><span><b>{roles.length}</b>Access roles</span></div></div>
      {notice && <div className="access-success" role="status">{notice}</div>}{error && <div className="access-error" role="alert">{error}<Button variant="outline" onClick={load}>Retry</Button></div>}
      <Tabs defaultValue={can('users.manage') ? 'users' : 'roles'} className="admin-tabs"><TabsList>{can('users.manage') && <TabsTrigger value="users">Users</TabsTrigger>}<TabsTrigger value="roles">Roles & permissions</TabsTrigger></TabsList>
        {can('users.manage') && <TabsContent value="users"><section className="admin-panel"><div className="admin-panel-heading"><div><h2>Department accounts</h2><p>Create an account when a department needs access.</p></div><Button onClick={() => { setFormError(''); setUserForm({ name: '', username: '', password: '', roleId: roles.some(r => r.id === 'editor') ? 'editor' : '', active: true }); }}><Plus /> Create user</Button></div><div className="admin-search"><Search /><Input aria-label="Search users" placeholder="Search name or username" value={search} onChange={e => setSearch(e.target.value)} /></div>
          {loading ? <p className="admin-empty">Loading accounts…</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Department / user</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map(item => <tr key={item.id}><td><div className="admin-user-name"><span className="admin-avatar">{item.name.slice(0, 2).toUpperCase()}</span><span><b>{item.name}</b><small>@{item.username}{item.id === user.id ? ' · You' : ''}</small></span></div></td><td><span className="access-badge">{roles.find(r => r.id === item.roleId)?.name || item.roleId}</span></td><td><span className={`access-status ${item.active ? '' : 'disabled'}`}>{item.active ? item.mustChangePassword ? 'Password setup pending' : 'Active' : 'Disabled'}</span></td><td><div className="admin-row-actions"><Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`} onClick={() => { setFormError(''); setUserForm({ ...item, active: Boolean(item.active), password: '' }); }}><Pencil /> Edit & assign role</Button>{item.id !== user.id && <Button variant="ghost" size="sm" aria-label={`Reset password for ${item.name}`} onClick={() => { setFormError(''); setResetPassword(''); setResetUser(item); }}><KeyRound /> Reset password</Button>}</div></td></tr>)}</tbody></table>{!visibleUsers.length && <p className="admin-empty">No accounts match your search.</p>}</div>}
        </section></TabsContent>}
        <TabsContent value="roles"><section className="admin-panel"><div className="admin-panel-heading"><div><h2>Roles & permissions</h2><p>Reuse a role across departments. Changes apply to every account assigned to it.</p></div>{can('roles.manage') && <Button onClick={() => { setFormError(''); setRoleForm({ name: '', description: '', permissions: [] }); }}><Plus /> Create role</Button>}</div><div className="admin-role-grid">{roles.map(role => <article className="admin-role-card" key={role.id}><div><ShieldCheck /><span className="access-badge">{role.id === 'admin' ? 'Full access' : `${role.permissions.length} permissions`}</span></div><h3>{role.name}</h3><p>{role.description}</p><small>{role.assignedCount} assigned accounts</small><div className="admin-role-actions"><Button variant="outline" onClick={() => { setFormError(''); setRoleForm({ ...role, permissions: [...role.permissions] }); }}>{role.id === 'admin' || !can('roles.manage') ? 'View permissions' : 'Edit permissions'}</Button>{role.id !== 'admin' && can('roles.manage') && <Button variant="outline" className="role-delete-button" aria-label={`Delete role ${role.name}`} onClick={() => { setFormError(''); setDeleteRole(role); }}><Trash2 /> Delete role</Button>}</div></article>)}</div></section></TabsContent>
      </Tabs>
    </div>
    <Dialog open={Boolean(userForm)} onOpenChange={open => { if (!open && !busy) setUserForm(null); }}><DialogContent className="access-dialog"><DialogHeader><DialogTitle>{userForm?.id ? 'Edit account' : 'Create department account'}</DialogTitle><DialogDescription>{userForm?.id ? 'Role and status changes end existing sessions.' : 'Share the username and temporary password with the department securely.'}</DialogDescription></DialogHeader>{userForm && <form className="access-form" onSubmit={e => { e.preventDefault(); void save('users', userForm, userForm.id ? 'Account updated.' : 'Account created. The user will choose a new password at first sign-in.'); }}><label>Department / display name<Input required maxLength={80} value={userForm.name} onChange={e => setUserForm({ ...userForm, name: e.target.value })} /></label><label>Username<Input required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{1,39}" autoComplete="off" autoCapitalize="none" value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value.toLowerCase() })} /></label><label>Role<NativeSelect required value={userForm.roleId} onChange={e => setUserForm({ ...userForm, roleId: e.target.value })}><NativeSelectOption value="" disabled>Select a role</NativeSelectOption>{roles.filter(r => user.isAdmin || (r.id !== 'admin' && r.permissions.every(p => can(p)))).map(role => <NativeSelectOption key={role.id} value={role.id}>{role.name}</NativeSelectOption>)}</NativeSelect><small>Permissions come from this role. Create or customize it in Roles & permissions.</small></label>{!userForm.id && <label>Temporary password<Input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} /><small>At least 12 characters. The user must change it at first sign-in.</small></label>}<label className="access-check"><Checkbox checked={userForm.active} disabled={userForm.id === user.id} onCheckedChange={checked => setUserForm({ ...userForm, active: Boolean(checked) })} /> Account enabled</label>{formError && <p className="access-error" role="alert">{formError}</p>}<div className="access-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setUserForm(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : userForm.id ? 'Save changes' : 'Create user'}</Button></div></form>}</DialogContent></Dialog>
    <Dialog open={Boolean(roleForm)} onOpenChange={open => { if (!open && !busy) setRoleForm(null); }}><DialogContent className="access-dialog role-dialog"><DialogHeader><DialogTitle>{roleForm?.id === 'admin' ? 'Administrator permissions' : roleForm?.id ? 'Edit role' : 'Create role'}</DialogTitle><DialogDescription>{roleForm?.id === 'admin' ? 'Administrators retain access to every feature.' : 'Select the templates, buttons and pages this role can use. Builder access requires at least one template. Users will sign in again after changes.'}</DialogDescription></DialogHeader>{roleForm && <form className="access-form" onSubmit={e => { e.preventDefault(); void save('roles', roleForm, 'Role saved. Open Users → Edit & assign role to assign it to an account.'); }}><label>Role name<Input required maxLength={80} readOnly={roleForm.id === 'admin' || !can('roles.manage')} value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })} /></label><label>Description<Input maxLength={250} readOnly={roleForm.id === 'admin' || !can('roles.manage')} value={roleForm.description} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })} /></label><div className="permission-grid">{PERMISSION_GROUPS.map(group => <fieldset key={group.name}><legend>{group.name}</legend>{group.items.map(([key, label]) => <label className="access-check" key={key}><Checkbox checked={roleForm.permissions.includes(key)} disabled={roleForm.id === 'admin' || !can('roles.manage') || !can(key)} onCheckedChange={checked => setRoleForm({ ...roleForm, permissions: checked ? [...roleForm.permissions, key] : roleForm.permissions.filter(p => p !== key) })} /><span>{label}</span></label>)}</fieldset>)}</div>{formError && <p className="access-error" role="alert">{formError}</p>}<div className="access-form-actions"><Button variant="outline" type="button" disabled={busy} onClick={() => setRoleForm(null)}>Close</Button>{roleForm.id !== 'admin' && can('roles.manage') && <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save role'}</Button>}</div></form>}</DialogContent></Dialog>
    <Dialog open={Boolean(resetUser)} onOpenChange={open => { if (!open && !busy) { setResetUser(null); setResetPassword(''); } }}><DialogContent className="access-dialog"><DialogHeader><DialogTitle>Reset password</DialogTitle><DialogDescription>Set a temporary password for {resetUser?.name}. Existing sessions will end, and the department will choose a new password at next sign-in.</DialogDescription></DialogHeader><form className="access-form" onSubmit={e => { e.preventDefault(); void save('reset-password', { id: resetUser?.id, password: resetPassword }, 'Password reset. Share the new temporary password securely.'); }}><label>New temporary password<Input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={resetPassword} onChange={e => setResetPassword(e.target.value)} /></label>{formError && <p className="access-error" role="alert">{formError}</p>}<div className="access-form-actions"><Button type="button" variant="outline" onClick={() => setResetUser(null)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</Button></div></form></DialogContent></Dialog>
    <AlertDialog open={Boolean(deleteRole)} onOpenChange={open => { if (!open && !busy) setDeleteRole(null); }}>
      <AlertDialogContent className="access-dialog"><AlertDialogHeader>
        <AlertDialogTitle>{deleteRole?.assignedCount ? 'Reassign accounts first' : 'Delete role?'}</AlertDialogTitle>
        <AlertDialogDescription>{deleteRole?.assignedCount ? `“${deleteRole.name}” is assigned to ${deleteRole.assignedCount} account(s). Move all of them to another role in Users before deleting it. Disabled accounts count too.` : `Delete “${deleteRole?.name}”? Its permission settings will be permanently removed. This cannot be undone.`}</AlertDialogDescription>
      </AlertDialogHeader>{formError && <p className="access-error" role="alert">{formError}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy || Boolean(deleteRole?.assignedCount)} onClick={() => void confirmDeleteRole()}>{busy ? 'Deleting…' : 'Delete role'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
