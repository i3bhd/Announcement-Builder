import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const accessRoles = sqliteTable('access_roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  permissions: text('permissions').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

export const accessUsers = sqliteTable('access_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: integer('must_change_password').notNull().default(1),
  roleId: text('role_id').notNull().references(() => accessRoles.id),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const accessSessions = sqliteTable('access_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => accessUsers.id),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('idx_access_sessions_user').on(table.userId)]);

export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  resetAt: integer('reset_at').notNull(),
});

export const userDrafts = sqliteTable('user_drafts', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => accessUsers.id),
  template: text('template').notNull(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('idx_user_drafts_user_id').on(table.userId, table.id)]);

export const vendorLibrary = sqliteTable('vendor_library', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const announcementAudit = sqliteTable('announcement_audit', {
  id: text('id').primaryKey(),
  announcementId: text('announcement_id').notNull(),
  announcementName: text('announcement_name').notNull(),
  template: text('template').notNull(),
  status: text('status').notNull(),
  source: text('source').notNull(),
  vendorId: text('vendor_id'),
  vendorEn: text('vendor_en'),
  vendorAr: text('vendor_ar'),
  integrationsJson: text('integrations_json').notNull().default('[]'),
  startDate: text('start_date'),
  startTime: text('start_time'),
  endDate: text('end_date'),
  endTime: text('end_time'),
  durationMinutes: integer('duration_minutes').notNull().default(0),
  sentAt: text('sent_at').notNull(),
  sentBy: text('sent_by').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
}, (table) => [
  index('idx_announcement_audit_sent_at').on(table.sentAt),
  index('idx_announcement_audit_vendor').on(table.vendorEn),
  index('idx_announcement_audit_status').on(table.status),
]);
