CREATE TABLE `forge_materials` (
	`user_id` integer NOT NULL,
	`material_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `material_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_progress` (
	`user_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`tier` integer DEFAULT 1 NOT NULL,
	`saddled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
