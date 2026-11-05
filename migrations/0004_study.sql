CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`mode` text NOT NULL,
	`action_type` text NOT NULL,
	`content` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_user_idx` ON `activity_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_session_idx` ON `activity_log` (`session_id`);--> statement-breakpoint
CREATE TABLE `concept_maps` (
	`doc_hash` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`error` text,
	`data_json` text,
	`model` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`doc_hash`, `version`)
);
--> statement-breakpoint
CREATE TABLE `concept_mastery` (
	`user_id` integer NOT NULL,
	`doc_hash` text NOT NULL,
	`concept_key` text NOT NULL,
	`concept` text NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`wrong_streak` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text,
	`last_wrong_at` text,
	PRIMARY KEY(`user_id`, `doc_hash`, `concept_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exam_answers` (
	`exam_id` text NOT NULL,
	`idx` integer NOT NULL,
	`answer` text,
	`flagged` integer DEFAULT false NOT NULL,
	`correct` integer,
	`answered_at` text NOT NULL,
	PRIMARY KEY(`exam_id`, `idx`),
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exam_questions` (
	`exam_id` text NOT NULL,
	`idx` integer NOT NULL,
	`question` text NOT NULL,
	`options_json` text NOT NULL,
	`correct_answer` text NOT NULL,
	`explanation` text,
	`concept` text NOT NULL,
	`difficulty` text NOT NULL,
	PRIMARY KEY(`exam_id`, `idx`),
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`doc_hash` text NOT NULL,
	`doc_name` text NOT NULL,
	`length` integer NOT NULL,
	`difficulty` text NOT NULL,
	`topics_json` text NOT NULL,
	`time_limit_s` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` text NOT NULL,
	`deadline` text NOT NULL,
	`submitted_at` text,
	`total` integer NOT NULL,
	`score` integer,
	`accuracy` real,
	`time_used_s` integer,
	`breakdown_json` text,
	`auto_submitted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exams_user_idx` ON `exams` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `generation_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_cache_expiry_idx` ON `generation_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `missed_questions` (
	`user_id` integer NOT NULL,
	`doc_hash` text NOT NULL,
	`text_key` text NOT NULL,
	`concept_key` text NOT NULL,
	`concept` text NOT NULL,
	`source` text NOT NULL,
	`question` text NOT NULL,
	`correct_answer` text NOT NULL,
	`explanation` text,
	`missed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `doc_hash`, `text_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quiz_answers` (
	`quiz_id` text NOT NULL,
	`question_id` integer NOT NULL,
	`answer` text NOT NULL,
	`correct` integer NOT NULL,
	`answered_at` text NOT NULL,
	PRIMARY KEY(`quiz_id`, `question_id`),
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quiz_bank` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`doc_hash` text NOT NULL,
	`topic_key` text NOT NULL,
	`question_type` text NOT NULL,
	`text_key` text NOT NULL,
	`question_json` text NOT NULL,
	`served` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_bank_unique` ON `quiz_bank` (`user_id`,`doc_hash`,`topic_key`,`question_type`,`text_key`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`topic` text NOT NULL,
	`question_type` text NOT NULL,
	`questions_json` text NOT NULL,
	`question_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	`correct_count` integer,
	`accuracy` real,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quizzes_user_idx` ON `quizzes` (`user_id`);--> statement-breakpoint
CREATE TABLE `review_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`doc_hash` text NOT NULL,
	`item_key` text NOT NULL,
	`source` text NOT NULL,
	`concept` text,
	`concept_key` text,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`explanation` text,
	`state` integer DEFAULT 0 NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`due` text NOT NULL,
	`last_review` text,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_unique` ON `review_items` (`user_id`,`doc_hash`,`item_key`);--> statement-breakpoint
CREATE INDEX `review_items_due_idx` ON `review_items` (`user_id`,`due`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`was_new` integer NOT NULL,
	`reviewed_at` text NOT NULL,
	`local_date` text NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `review_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_logs_day_idx` ON `review_logs` (`user_id`,`local_date`);