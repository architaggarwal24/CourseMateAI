CREATE TABLE `ai_budget` (
	`scope` text NOT NULL,
	`day` text NOT NULL,
	`spent_micro` integer DEFAULT 0 NOT NULL,
	`reserved_micro` integer DEFAULT 0 NOT NULL,
	`limit_micro` integer NOT NULL,
	PRIMARY KEY(`scope`, `day`),
	CONSTRAINT "ai_budget_reserved_not_negative" CHECK("ai_budget"."reserved_micro" >= 0),
	CONSTRAINT "ai_budget_within_limit" CHECK("ai_budget"."spent_micro" + "ai_budget"."reserved_micro" <= "ai_budget"."limit_micro")
);
--> statement-breakpoint
-- What each day has already cost goes into the global row, so the spend cap counts the calls made before this
-- migration on the day it runs (src/server/ai/budget.ts).
INSERT INTO `ai_budget` (`scope`, `day`, `spent_micro`, `reserved_micro`, `limit_micro`)
SELECT 'global', `day`, coalesce(sum(`cost_micro_usd`), 0), 0, coalesce(sum(`cost_micro_usd`), 0) FROM `ai_usage` GROUP BY `day`;
