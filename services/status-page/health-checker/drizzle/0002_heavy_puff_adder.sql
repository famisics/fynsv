CREATE TABLE `rollups_30m` (
	`bucket_ms` integer NOT NULL,
	`service_id` text NOT NULL,
	`up_count` integer NOT NULL,
	`down_count` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`resource_count` integer NOT NULL,
	`cpu_sum` real,
	`mem_used_sum` real,
	`mem_total_sum` real,
	`disk_used_sum` real,
	`disk_total_sum` real,
	`net_in_sum` real,
	`net_out_sum` real,
	PRIMARY KEY(`bucket_ms`, `service_id`)
);
