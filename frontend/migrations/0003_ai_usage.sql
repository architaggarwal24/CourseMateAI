CREATE TABLE `ai_usage` (
	`day` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`job` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`fallbacks` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `provider`, `model`, `job`)
);
--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`user_id` integer NOT NULL,
	`day` text NOT NULL,
	`ai_calls` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
