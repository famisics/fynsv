CREATE TABLE IF NOT EXISTS `service_meta` (
	`version` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schema_version` integer NOT NULL,
	`data` text NOT NULL,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_snapshots_time` ON `snapshots` (`recorded_at`);
