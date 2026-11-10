CREATE TABLE `plan_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`tier` text NOT NULL,
	`from_tier` text NOT NULL,
	`from_expires_at` text,
	`source` text NOT NULL,
	`expires_at` text,
	`note` text,
	`granted_by` integer,
	`created_at` text NOT NULL,
	`seen_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_notices_user_idx` ON `plan_notices` (`user_id`,`seen_at`);