'use client';

import { LogOut, Settings2, UserRound } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/components/access-context';

export function AccountMenu() {
  const { user, can } = useAccess();
  return <Popover><PopoverTrigger render={<Button variant="outline" className="account-trigger" aria-label="Your account" />}><UserRound /><span>{user.name.split(' ')[0]}</span></PopoverTrigger><PopoverContent className="account-popover" align="end">
    <strong>{user.name}</strong><small>@{user.username}</small><span className="access-badge">{user.roleName}</span>
    {(can('users.manage') || can('roles.manage')) && <a href="/admin"><Settings2 /> Users & roles</a>}
    {!can('users.manage') && !can('roles.manage') && <p className="account-permission-hint">User and role management requires administrator permissions. Contact your Technology administrator.</p>}
    <a href="/account"><UserRound /> My account</a>
    <form action="/api/access/logout" method="post"><button><LogOut /> Sign out</button></form>
  </PopoverContent></Popover>;
}
