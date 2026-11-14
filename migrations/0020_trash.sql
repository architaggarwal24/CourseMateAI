CREATE TABLE `deletion_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`action` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text,
	`item_name` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deletion_log_user_idx` ON `deletion_log` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `trash` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`row` text NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`deleted_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trash_user_idx` ON `trash` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `trash_chunks` (
	`user_id` integer NOT NULL,
	`document_id` text NOT NULL,
	`idx` integer NOT NULL,
	`page` integer NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`document_id`, `idx`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
