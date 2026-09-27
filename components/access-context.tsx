'use client';

import { createContext, useContext } from 'react';
import { hasPermission, type Permission, type SessionUser } from '@/lib/permissions';

export const AccessContext = createContext<SessionUser | null>(null);
export function useAccess() {
  const user = useContext(AccessContext);
  if (!user) throw new Error('This screen requires a signed-in user.');
  return { user, can: (permission: Permission) => hasPermission(user, permission) };
}

export function AccessProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <AccessContext.Provider value={user}>{children}</AccessContext.Provider>;
}

export async function authorizeAction(permission: Permission, template?: string) {
  const response = await fetch('/api/access/authorize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission, template }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || 'Your session or permissions have changed. Please sign in again.');
  }
}
