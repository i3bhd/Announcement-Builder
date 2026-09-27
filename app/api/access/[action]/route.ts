import { database } from '@/lib/database';
import { ALL_PERMISSIONS, DEFAULT_ROLES, hasPermission, homeFor, type Permission } from '@/lib/permissions';
import { AccessError, createSession, failure, hashPassword, json, logout, rateLimit, readBody, requireUser, sameOrigin, sessionUser, setupAvailable, templateAccess, validName, validPassword, validUsername, verifyPassword, verifySetupToken } from '@/lib/access-server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { action } = await context.params;
    if (action === 'me') return json({ user: await sessionUser() });
    const user = await requireUser();
    if (action === 'admin') {
      if (!hasPermission(user, 'users.manage') && !hasPermission(user, 'roles.manage')) throw new AccessError('Access denied.');
      const roles = await database().prepare('SELECT r.id, r.name, r.description, r.permissions, (SELECT COUNT(*) FROM access_users u WHERE u.role_id = r.id) AS assignedCount FROM access_roles r ORDER BY r.name').all<{ id: string; name: string; description: string; permissions: string; assignedCount: number }>();
      const users = hasPermission(user, 'users.manage') ? (await database().prepare('SELECT id, name, username, role_id AS roleId, active, must_change_password AS mustChangePassword, created_at AS createdAt FROM access_users ORDER BY name').all()).results : [];
      return json({ users, roles: roles.results.map(role => ({ ...role, permissions: JSON.parse(role.permissions) })) });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { action } = await context.params;
    if (action === 'logout') {
      await logout();
      return new Response(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
    }
    const body = await readBody(request);
    if (action === 'login') {
      const username = validUsername(body.username);
      await rateLimit(request, username);
      if (typeof body.password !== 'string' || body.password.length > 128) throw new AccessError('Incorrect username or password.', 401);
      const row = await database().prepare('SELECT id, password_hash, active FROM access_users WHERE username = ?').bind(username).first<{ id: string; password_hash: string; active: number }>();
      const valid = await verifyPassword(body.password, row?.password_hash || 'pbkdf2$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000');
      if (!row || !row.active || !valid) throw new AccessError('Incorrect username or password.', 401);
      await createSession(row.id);
      return json({ ok: true });
    }
    if (action === 'setup') {
      if (!verifySetupToken(body.setupToken) || !(await setupAvailable())) throw new AccessError('A valid server setup key is required before the first account is created.');
      validPassword(body.password);
      const now = new Date().toISOString();
      const hash = await hashPassword(body.password);
      const statements = DEFAULT_ROLES.map(role => database().prepare('INSERT OR IGNORE INTO access_roles (id, name, description, permissions, created_at) VALUES (?, ?, ?, ?, ?)').bind(role.id, role.name, role.description, JSON.stringify(role.permissions), now));
      const id = crypto.randomUUID();
      statements.push(database().prepare(`INSERT INTO access_users (id, name, username, password_hash, must_change_password, role_id, active, created_at, updated_at)
        SELECT ?, 'Information Technology', 'technology', ?, 0, 'admin', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM access_users)`).bind(id, hash, now, now));
      const results = await database().batch(statements);
      if (!results[results.length - 1].meta.changes) throw new AccessError('Administrator setup has already been completed.', 409);
      await createSession(id);
      return json({ ok: true });
    }
    const user = await requireUser(undefined, action === 'password');
    if (action === 'password') {
      await rateLimit(request, user.username);
      validPassword(body.password);
      const row = await database().prepare('SELECT password_hash FROM access_users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
      if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 || !row || !(await verifyPassword(body.currentPassword, row.password_hash))) throw new AccessError('The current password is incorrect.', 400);
      if (body.password === body.currentPassword) throw new AccessError('Choose a different password.', 400);
      await database().batch([
        database().prepare('UPDATE access_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').bind(await hashPassword(body.password), new Date().toISOString(), user.id),
        database().prepare('DELETE FROM access_sessions WHERE user_id = ?').bind(user.id),
      ]);
      await createSession(user.id);
      return json({ ok: true });
    }
    if (action === 'authorize') {
      if (!ALL_PERMISSIONS.includes(body.permission) || !hasPermission(user, body.permission)) throw new AccessError('Your role does not allow this action.');
      if (body.template !== undefined) templateAccess(user, body.template);
      return json({ ok: true });
    }
    if (action === 'users') {
      if (!hasPermission(user, 'users.manage')) throw new AccessError('You cannot manage users.');
      const name = validName(body.name);
      const username = validUsername(body.username);
      const role = await database().prepare('SELECT id, permissions FROM access_roles WHERE id = ?').bind(String(body.roleId)).first<{ id: string; permissions: string }>();
      if (!role) throw new AccessError('Choose an existing role.', 400);
      if (!user.isAdmin && (role.id === 'admin' || JSON.parse(role.permissions).some((p: Permission) => !hasPermission(user, p)))) throw new AccessError('Only an administrator can assign greater access than their own.');
      const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
      const existing = body.id ? await database().prepare('SELECT role_id FROM access_users WHERE id = ?').bind(id).first<{ role_id: string }>() : null;
      if (body.id && !existing) throw new AccessError('This user no longer exists.', 404);
      if (existing?.role_id === 'admin' && !user.isAdmin) throw new AccessError('Only an administrator can change an administrator.');
      if (id === user.id && (body.active === false || role.id !== user.roleId)) throw new AccessError('Another administrator must change your own role or disable your account.', 400);
      const duplicate = await database().prepare('SELECT id FROM access_users WHERE username = ? AND id != ?').bind(username, id).first();
      if (duplicate) throw new AccessError('That username is already in use.', 409);
      const now = new Date().toISOString();
      const active = body.active === false ? 0 : 1;
      if (!existing) {
        validPassword(body.password);
        await database().prepare('INSERT INTO access_users (id, name, username, password_hash, must_change_password, role_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)').bind(id, name, username, await hashPassword(body.password), role.id, active, now, now).run();
      } else {
        const result = await database().prepare(`UPDATE access_users SET name = ?, username = ?, role_id = ?, active = ?, updated_at = ?
          WHERE id = ? AND (role_id != 'admin' OR active = 0 OR (? = 'admin' AND ? = 1) OR (SELECT COUNT(*) FROM access_users WHERE role_id = 'admin' AND active = 1) > 1)`).bind(name, username, role.id, active, now, id, role.id, active).run();
        if (!result.meta.changes) throw new AccessError('At least one active administrator is required.', 409);
        await database().prepare('DELETE FROM access_sessions WHERE user_id = ?').bind(id).run();
        if (id === user.id) await createSession(user.id);
      }
      return json({ ok: true });
    }
    if (action === 'reset-password') {
      if (!hasPermission(user, 'users.manage')) throw new AccessError('You cannot reset passwords.');
      validPassword(body.password);
      const target = await database().prepare('SELECT id, role_id FROM access_users WHERE id = ?').bind(String(body.id)).first<{ id: string; role_id: string }>();
      if (!target) throw new AccessError('User not found.', 404);
      if (target.id === user.id) throw new AccessError('Change your own password from My account.', 400);
      if (target.role_id === 'admin' && !user.isAdmin) throw new AccessError('Only an administrator can reset another administrator’s password.');
      await database().batch([
        database().prepare('UPDATE access_users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').bind(await hashPassword(body.password), new Date().toISOString(), target.id),
        database().prepare('DELETE FROM access_sessions WHERE user_id = ?').bind(target.id),
      ]);
      return json({ ok: true });
    }
    if (action === 'roles') {
      if (!hasPermission(user, 'roles.manage')) throw new AccessError('You cannot manage roles.');
      if (body.id === 'admin') throw new AccessError('The Administrator role always retains full access.');
      const name = validName(body.name);
      const description = typeof body.description === 'string' ? body.description.slice(0, 250) : '';
      if (!Array.isArray(body.permissions) || body.permissions.some((p: Permission) => !ALL_PERMISSIONS.includes(p))) throw new AccessError('Choose valid permissions.', 400);
      const permissions = Array.from(new Set(body.permissions)) as Permission[];
      if (!user.isAdmin && permissions.some(p => !hasPermission(user, p))) throw new AccessError('You cannot grant permissions you do not have.');
      if (!user.isAdmin && body.id) {
        const existing = await database().prepare('SELECT permissions FROM access_roles WHERE id = ?').bind(String(body.id)).first<{ permissions: string }>();
        if (existing && JSON.parse(existing.permissions).some((p: Permission) => !hasPermission(user, p))) throw new AccessError('Only an administrator can modify this role.');
      }
      if (body.id === user.roleId) throw new AccessError('Ask another administrator to modify your assigned role.', 400);
      if (permissions.includes('builder.view') && !permissions.includes('template.service') && !permissions.includes('template.general')) throw new AccessError('Builder access requires at least one template.', 400);
      const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
      await database().prepare(`INSERT INTO access_roles (id, name, description, permissions, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, permissions = excluded.permissions`).bind(id, name, description, JSON.stringify(permissions), new Date().toISOString()).run();
      await database().prepare('DELETE FROM access_sessions WHERE user_id IN (SELECT id FROM access_users WHERE role_id = ?)').bind(id).run();
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser('roles.manage');
    if ((await context.params).action !== 'roles') throw new AccessError('Not found.', 404);
    const body = await readBody(request);
    if (typeof body.id !== 'string' || !body.id) throw new AccessError('Choose a role.', 400);
    if (body.id === 'admin') throw new AccessError('The Administrator role cannot be deleted.');
    const role = await database().prepare('SELECT id, permissions FROM access_roles WHERE id = ?').bind(body.id).first<{ id: string; permissions: string }>();
    if (!role) throw new AccessError('This role no longer exists.', 404);
    if (!user.isAdmin && JSON.parse(role.permissions).some((p: Permission) => !hasPermission(user, p))) throw new AccessError('You cannot delete a role with greater access than your own.');
    // Conditional deletion also protects against an assignment made after the dialog opened.
    const result = await database().prepare("DELETE FROM access_roles WHERE id = ? AND id != 'admin' AND NOT EXISTS (SELECT 1 FROM access_users WHERE role_id = ?)").bind(role.id, role.id).run();
    if (!result.meta.changes) throw new AccessError('Reassign all accounts using this role before deleting it, including disabled accounts.', 409);
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
