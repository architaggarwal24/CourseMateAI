CREATE TABLE `champion_progress` (
	`user_id` integer NOT NULL,
	`champion_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`battles` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `champion_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `daily_action_counts` (
	`user_id` integer NOT NULL,
	`action_date` text NOT NULL,
	`action_type` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_ts` text,
	PRIMARY KEY(`user_id`, `action_date`, `action_type`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `daily_quests` (
	`user_id` integer NOT NULL,
	`quest_date` text NOT NULL,
	`quest_type` text NOT NULL,
	`target_count` integer NOT NULL,
	`current_count` integer DEFAULT 0 NOT NULL,
	`reward_xp` integer NOT NULL,
	`reward_coins` integer NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`claimed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `quest_date`, `quest_type`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reward_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`source_id` text,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_events_idempotency_key_unique` ON `reward_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `reward_events_user_idx` ON `reward_events` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `user_achievements` (
	`user_id` integer NOT NULL,
	`achievement_id` text NOT NULL,
	`unlocked_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `achievement_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_avatar` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`equipped_json` text DEFAULT '{}' NOT NULL,
	`owned_json` text DEFAULT '[]' NOT NULL,
	`champion_id` text,
	`champion_set_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_buffs` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`buffs_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_inventory` (
	`user_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_progress` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`current_level` integer DEFAULT 1 NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`streak_days` integer DEFAULT 0 NOT NULL,
	`last_active_utc` text,
	`streak_freezes` integer DEFAULT 0 NOT NULL,
	`total_arena_rounds` integer DEFAULT 0 NOT NULL,
	`total_bosses_defeated` integer DEFAULT 0 NOT NULL,
	`total_quizzes_completed` integer DEFAULT 0 NOT NULL,
	`total_chat_questions` integer DEFAULT 0 NOT NULL,
	`total_chat_bundles` integer DEFAULT 0 NOT NULL,
	`total_notes_generated` integer DEFAULT 0 NOT NULL,
	`total_flashcards_studied` integer DEFAULT 0 NOT NULL,
	`best_quiz_accuracy` integer DEFAULT 0 NOT NULL,
	`nightmare_bosses_defeated` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
