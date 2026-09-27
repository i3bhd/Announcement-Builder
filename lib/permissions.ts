export const PERMISSION_GROUPS = [
  { name: 'Announcements', items: [
    ['builder.view', 'Open the builder'],
    ['announcement.create', 'Create and duplicate announcements'],
    ['announcement.edit', 'Edit announcement content'],
    ['drafts.manage', 'Save, open and delete own drafts'],
    ['announcement.send', 'Mark announcements as sent'],
  ] },
  { name: 'Templates', items: [
    ['template.service', 'Service announcement'],
    ['template.general', 'General bilingual message'],
  ] },
  { name: 'Exports', items: [
    ['export.html', 'HTML and HTML snippet'],
    ['export.png', 'PNG image'],
    ['export.pdf', 'PDF document'],
  ] },
  { name: 'Dashboard & library', items: [
    ['dashboard.view', 'View the dashboard and sent history'],
    ['dashboard.export', 'Export dashboard CSV and PDF'],
    ['vendors.manage', 'Manage vendors and services'],
  ] },
  { name: 'Administration', items: [
    ['users.manage', 'Create and manage users'],
    ['roles.manage', 'Create and manage roles'],
  ] },
] as const;

export type Permission = typeof PERMISSION_GROUPS[number]['items'][number][0];
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(group => group.items.map(item => item[0])) as Permission[];
export type SessionUser = { id: string; name: string; username: string; roleId: string; roleName: string; isAdmin: boolean; permissions: Permission[]; mustChangePassword: boolean };
export const DEFAULT_ROLES = [
  { id: 'admin', name: 'Administrator', description: 'Full access, including users and roles.', permissions: ALL_PERMISSIONS },
  { id: 'editor', name: 'Editor', description: 'Create, edit and export announcements. Cannot mark as sent or manage access.', permissions: ALL_PERMISSIONS.filter(p => !['announcement.send', 'users.manage', 'roles.manage', 'vendors.manage'].includes(p)) },
  { id: 'publisher', name: 'Publisher', description: 'Prepare announcements, manage the service library and mark as sent.', permissions: ALL_PERMISSIONS.filter(p => !['users.manage', 'roles.manage'].includes(p)) },
  { id: 'viewer', name: 'Viewer', description: 'View the dashboard and sent history.', permissions: ['dashboard.view'] as Permission[] },
];

export function hasPermission(user: SessionUser, permission: Permission) {
  return user.isAdmin || user.permissions.includes(permission);
}

export function homeFor(user: SessionUser) {
  if (hasPermission(user, 'builder.view') && (hasPermission(user, 'template.service') || hasPermission(user, 'template.general'))) return '/';
  if (hasPermission(user, 'dashboard.view')) return '/dashboard';
  if (hasPermission(user, 'users.manage') || hasPermission(user, 'roles.manage')) return '/admin';
  return '/account';
}
