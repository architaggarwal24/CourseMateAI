CREATE TABLE `arena_gauntlets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`doc_hash` text NOT NULL,
	`kind` text NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`power` integer NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`plan_json` text DEFAULT '[]' NOT NULL,
	`hearts` integer NOT NULL,
	`max_hearts` integer NOT NULL,
	`battle_id` text,
	`score` integer DEFAULT 0 NOT NULL,
	`answered` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`chests_json` text DEFAULT '[]' NOT NULL,
	`last_species` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `arena_gauntlets_user_idx` ON `arena_gauntlets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `arena_gauntlets_board_idx` ON `arena_gauntlets` (`kind`,`status`,`score`);--> statement-breakpoint
CREATE UNIQUE INDEX `arena_gauntlets_active_idx` ON `arena_gauntlets` (`user_id`,`session_id`) WHERE status = 'active';--> statement-breakpoint
ALTER TABLE `arena_battles` ADD `gauntlet_id` text;--> statement-breakpoint
CREATE INDEX `arena_battles_gauntlet_idx` ON `arena_battles` (`gauntlet_id`);