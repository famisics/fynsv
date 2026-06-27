CREATE TABLE `__new_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schema_version` integer NOT NULL,
	`data` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_at_ms` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_snapshots` (`id`, `schema_version`, `data`, `recorded_at`, `recorded_at_ms`)
SELECT `id`, `schema_version`, `data`, `recorded_at`, CAST((julianday(`recorded_at`) - 2440587.5) * 86400000 AS INTEGER) FROM `snapshots`;--> statement-breakpoint
DROP TABLE `snapshots`;--> statement-breakpoint
ALTER TABLE `__new_snapshots` RENAME TO `snapshots`;--> statement-breakpoint
CREATE INDEX `idx_snapshots_time` ON `snapshots` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_snapshots_ms` ON `snapshots` (`recorded_at_ms`);
