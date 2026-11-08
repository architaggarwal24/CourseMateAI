CREATE TABLE `quest_scrolls` (
	`user_id` integer NOT NULL,
	`scroll_id` text NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`event` text NOT NULL,
	`target` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`claimed_at` text,
	PRIMARY KEY(`user_id`, `scroll_id`, `period`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quest_scrolls_event` ON `quest_scrolls` (`user_id`,`event`);--> statement-breakpoint
ALTER TABLE `bestiary_records` ADD `lost_page` integer DEFAULT false NOT NULL;