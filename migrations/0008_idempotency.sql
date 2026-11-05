CREATE TABLE `idempotency_keys` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` integer,
	`body` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_created_idx` ON `idempotency_keys` (`created_at`);