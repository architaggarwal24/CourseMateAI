CREATE TABLE `champion_challenges` (
	`user_id` integer NOT NULL,
	`champion_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`done_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `champion_id`, `challenge_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
