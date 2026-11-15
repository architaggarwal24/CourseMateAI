CREATE TABLE `ai_wallet` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`balance_micro` integer DEFAULT 0 NOT NULL,
	`reserved_micro` integer DEFAULT 0 NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_wallet_reserved_not_negative" CHECK("ai_wallet"."reserved_micro" >= 0),
	CONSTRAINT "ai_wallet_within_balance" CHECK("ai_wallet"."reserved_micro" <= "ai_wallet"."balance_micro")
);
--> statement-breakpoint
CREATE TABLE `mana_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`micro` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mana_ledger_kind_ref` ON `mana_ledger` (`kind`,`ref`);--> statement-breakpoint
CREATE INDEX `mana_ledger_user_idx` ON `mana_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mana_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`pack` text NOT NULL,
	`amount_inr` integer NOT NULL,
	`mana_micro` integer NOT NULL,
	`status` text NOT NULL,
	`payment_id` text,
	`created_at` text NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mana_orders_user_idx` ON `mana_orders` (`user_id`,`created_at`);--> statement-breakpoint
-- A purchase, grant or refund in the ledger moves the wallet's balance, in the same statement as the ledger row:
-- the ledger's UNIQUE (kind, ref) therefore credits each order exactly once, however often it is reported.
CREATE TRIGGER `mana_ledger_credit` AFTER INSERT ON `mana_ledger` WHEN NEW.`kind` IN ('purchase', 'grant', 'refund')
BEGIN
  INSERT OR IGNORE INTO `ai_wallet` (`user_id`, `balance_micro`, `reserved_micro`) VALUES (NEW.`user_id`, 0, 0);
  UPDATE `ai_wallet` SET `balance_micro` = `balance_micro` + NEW.`micro`, `updated_at` = NEW.`created_at` WHERE `user_id` = NEW.`user_id`;
END;
