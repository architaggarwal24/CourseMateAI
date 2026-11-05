CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event` text NOT NULL,
	`subscription_id` text,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`tier` text NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`short_url` text,
	`current_start` text,
	`current_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_user_idx` ON `subscriptions` (`user_id`,`created_at`);