CREATE TABLE `arena_battles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`doc_hash` text NOT NULL,
	`topic` text NOT NULL,
	`difficulty` text NOT NULL,
	`board_key` text NOT NULL,
	`boss_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`phase` integer DEFAULT 1 NOT NULL,
	`boss_hp` integer NOT NULL,
	`boss_max_hp` integer NOT NULL,
	`player_hp` integer NOT NULL,
	`player_max_hp` integer NOT NULL,
	`combo` integer DEFAULT 0 NOT NULL,
	`max_combo` integer DEFAULT 0 NOT NULL,
	`answered` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`heals_used` integer DEFAULT 0 NOT NULL,
	`fifty_used` integer DEFAULT 0 NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`current_seq` integer,
	`gen_attempts_1` integer DEFAULT 0 NOT NULL,
	`gen_attempts_2` integer DEFAULT 0 NOT NULL,
	`rewards_json` text,
	`result_json` text,
	`mode` text DEFAULT 'quick' NOT NULL,
	`run_id` text,
	`focus` integer DEFAULT 0 NOT NULL,
	`focus_cap` integer DEFAULT 5 NOT NULL,
	`shield` integer DEFAULT 0 NOT NULL,
	`intent_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `arena_battles_user_idx` ON `arena_battles` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `arena_battles_run_idx` ON `arena_battles` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `arena_battles_active_idx` ON `arena_battles` (`user_id`,`session_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `arena_personal_bests` (
	`user_id` integer NOT NULL,
	`board_key` text NOT NULL,
	`battle_id` text NOT NULL,
	`grade` text NOT NULL,
	`accuracy` integer NOT NULL,
	`time_seconds` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `board_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `arena_questions` (
	`battle_id` text NOT NULL,
	`seq` integer NOT NULL,
	`phase` integer NOT NULL,
	`concept_key` text NOT NULL,
	`text_key` text NOT NULL,
	`question_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`options_json` text,
	`removed_json` text,
	`issued_at` text,
	`deadline_at` text,
	`answer` text,
	`correct` integer,
	`timed_out` integer,
	`answered_at` text,
	`outcome_json` text,
	`move` text,
	`timewarped` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`battle_id`, `seq`),
	FOREIGN KEY (`battle_id`) REFERENCES `arena_battles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `arena_questions_pool_idx` ON `arena_questions` (`battle_id`,`phase`,`status`);--> statement-breakpoint
CREATE TABLE `arena_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`doc_hash` text NOT NULL,
	`difficulty` text NOT NULL,
	`seed` integer NOT NULL,
	`acts_json` text NOT NULL,
	`map_json` text NOT NULL,
	`nemesis_ok` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`act` integer DEFAULT 1 NOT NULL,
	`node_id` text,
	`visited_json` text DEFAULT '[]' NOT NULL,
	`hearts` integer NOT NULL,
	`max_hearts` integer NOT NULL,
	`gold` integer DEFAULT 0 NOT NULL,
	`relics_json` text DEFAULT '[]' NOT NULL,
	`flags_json` text DEFAULT '{}' NOT NULL,
	`focus_cap` integer DEFAULT 5 NOT NULL,
	`act_focus_bonus` integer DEFAULT 0 NOT NULL,
	`pending_json` text,
	`battle_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`battles_won` integer DEFAULT 0 NOT NULL,
	`answered` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`rewards_json` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `arena_runs_user_idx` ON `arena_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `arena_runs_board_idx` ON `arena_runs` (`doc_hash`,`status`,`score`);--> statement-breakpoint
CREATE INDEX `arena_runs_finished_idx` ON `arena_runs` (`finished_at`,`score`);--> statement-breakpoint
CREATE UNIQUE INDEX `arena_runs_active_idx` ON `arena_runs` (`user_id`,`session_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `arena_scores` (
	`battle_id` text PRIMARY KEY NOT NULL,
	`board_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`username` text NOT NULL,
	`topic` text NOT NULL,
	`topic_key` text NOT NULL,
	`difficulty` text NOT NULL,
	`doc_hash` text NOT NULL,
	`grade` text NOT NULL,
	`accuracy` integer NOT NULL,
	`time_seconds` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`battle_id`) REFERENCES `arena_battles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `arena_scores_board_idx` ON `arena_scores` (`topic_key`,`difficulty`,`doc_hash`,`accuracy`,`time_seconds`);--> statement-breakpoint
CREATE INDEX `arena_scores_global_idx` ON `arena_scores` (`difficulty`,`created_at`);