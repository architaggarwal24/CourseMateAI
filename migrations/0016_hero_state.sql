CREATE TABLE `hero_state` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`look_json` text DEFAULT '' NOT NULL,
	`build_json` text DEFAULT '{}' NOT NULL,
	`tree_json` text DEFAULT '{}' NOT NULL,
	`owned_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
