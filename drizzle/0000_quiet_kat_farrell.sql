CREATE TABLE `announcement_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`announcement_id` text NOT NULL,
	`announcement_name` text NOT NULL,
	`template` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`vendor_id` text,
	`vendor_en` text,
	`vendor_ar` text,
	`integrations_json` text DEFAULT '[]' NOT NULL,
	`start_date` text,
	`start_time` text,
	`end_date` text,
	`end_time` text,
	`duration_minutes` integer DEFAULT 0 NOT NULL,
	`sent_at` text NOT NULL,
	`sent_by` text NOT NULL,
	`snapshot_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_announcement_audit_sent_at` ON `announcement_audit` (`sent_at`);--> statement-breakpoint
CREATE INDEX `idx_announcement_audit_vendor` ON `announcement_audit` (`vendor_en`);--> statement-breakpoint
CREATE INDEX `idx_announcement_audit_status` ON `announcement_audit` (`status`);--> statement-breakpoint
PRAGMA optimize;
