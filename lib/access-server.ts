import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { redirect } from 'next/navigation';
import { database } from '@/lib/database';
import { ALL_PERMISSIONS, hasPermission, type Permission, type SessionUser } from '@/lib/permissions';

const COOKIE = 'tamam_session';
export class AccessError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown) {
  if (error instanceof AccessError) return json({ error: error.message }, error.status);
  console.error('Access request failed', error);
  return json({ error: 'We could not complete this request. Please try again.' }, 500);
}
export async function readBody(request: Request) {
  if (Number(request.headers.get('content-length')) > 24_000_000) throw new AccessError('This request is too large.', 413);
  const raw = await request.text();
  if (raw.length > 24_000_000) throw new AccessError('This request is too large.', 413);
  try { return JSON.parse(raw); } catch { throw new AccessError('Invalid request.', 400); }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin !== (process.env.APP_ORIGIN || new URL(request.url).origin)) throw new AccessError('Please submit this action from the builder.');
}
export function validUsername(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,39}$/i.test(value.trim())) throw new AccessError('Use 2–40 letters, numbers, dots, hyphens or underscores for the username.', 400);
  return value.trim().toLowerCase();
}
export function validName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new AccessError('Enter a name of up to 80 characters.', 400);
  return value.trim();
}
export function validPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new AccessError('Use a password between 12 and 128 characters.', 400);
}
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function digest(value: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
export async function hashPassword(password: string, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${salt}$${hex(result)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  const computed = await hashPassword(password, parts[2] || '00000000000000000000000000000000');
  let difference = computed.length ^ stored.length;
  for (let i = 0; i < computed.length; i++) difference |= computed.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return difference === 0;
}
export async function setupAvailable() {
  if (!process.env.SETUP_TOKEN || process.env.SETUP_TOKEN.length < 32) return false;
  return !(await database().prepare('SELECT id FROM access_users LIMIT 1').first());
}
export function verifySetupToken(value: unknown) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 32 || typeof value !== 'string') return false;
  const supplied = Buffer.from(value), secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}
export async function sessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length !== 64) return null;
  const row = await database().prepare(`SELECT u.id, u.name, u.username, u.role_id, u.must_change_password, r.name AS role_name, r.permissions
    FROM access_sessions s JOIN access_users u ON u.id = s.user_id JOIN access_roles r ON r.id = u.role_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).bind(await digest(token), Date.now()).first<{
    id: string; name: string; username: string; role_id: string; must_change_password: number; role_name: string; permissions: string;
  }>();
  if (!row) return null;
  return { id: row.id, name: row.name, username: row.username, roleId: row.role_id, roleName: row.role_name, isAdmin: row.role_id === 'admin', permissions: JSON.parse(row.permissions).filter((p: Permission) => ALL_PERMISSIONS.includes(p)), mustChangePassword: Boolean(row.must_change_password) };
}
export async function requireUser(permission?: Permission, allowPasswordChange = false) {
  const user = await sessionUser();
  if (!user) throw new AccessError('Please sign in to continue.', 401);
  if (user.mustChangePassword && !allowPasswordChange) throw new AccessError('Please change your temporary password first.');
  if (permission && !hasPermission(user, permission)) throw new AccessError('Your role does not allow this action.');
  return user;
}
export async function pageUser(permission?: Permission) {
  const user = await sessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/account');
  if (permission && !hasPermission(user, permission)) redirect('/account');
  return user;
}
export function templateAccess(user: SessionUser, template: unknown) {
  if (!['service', 'general'].includes(String(template)) || !hasPermission(user, `template.${template}` as Permission)) throw new AccessError('Your role does not have access to this template.');
}
export async function createSession(userId: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await database().batch([
    database().prepare('DELETE FROM access_sessions WHERE expires_at < ?').bind(Date.now()),
    database().prepare('INSERT INTO access_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await digest(token), userId, Date.now() + 8 * 60 * 60 * 1000),
  ]);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.APP_ORIGIN?.startsWith('https://') ?? process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 });
}
export async function logout() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await database().prepare('DELETE FROM access_sessions WHERE token_hash = ?').bind(await digest(token)).run();
  (await cookies()).delete(COOKIE);
}
export async function rateLimit(request: Request, username: string) {
  // No trusted Cloudflare IP header in Docker. Ignore spoofable forwarding headers.
  const ip = 'standalone-global';
  const now = Date.now();
  const keys = [await digest(`ip:${ip}`), await digest(`user:${username}`)];
  for (const [index, key] of keys.entries()) {
    const result = await database().prepare(`INSERT INTO login_attempts (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at < ? THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END RETURNING count`).bind(key, now + 15 * 60000, now, now).first<{ count: number }>();
    if ((result?.count || 0) > (index === 0 ? 40 : 10)) throw new AccessError('Too many attempts. Please try again in 15 minutes.', 429);
  }
}
